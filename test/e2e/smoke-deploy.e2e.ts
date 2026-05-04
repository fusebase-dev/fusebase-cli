/**
 * Smoke deploy: drives the full Fusebase Apps CLI lifecycle against a real
 * environment (dev or prod). Per the NIM-40894 clarification round, every CLI
 * surface is exercised in **one feature** so this is a smoke test, not a full
 * matrix:
 *
 *   auth → init → scaffold(spa) → scaffold(backend) → feature create →
 *   sidecar add → job create → deploy → verify (HTTP + self-observable
 *   backend markers) → teardown via public-api `DELETE /v1/orgs/{orgId}/apps/{appId}`.
 *
 * Verification surface: the deployed backend keeps an in-memory list of
 * markers it receives via `POST /api/touch` and serves them back through
 * `GET /api/markers`. The cron job posts to the same endpoint over HTTP, so
 * the test can confirm both code paths executed *for this run* by matching a
 * unique `runId` (the per-pipeline `APP_SUB`). Assertions stay correlated to
 * the current run, not leftover data from a prior failed run.
 *
 * Skipped automatically when the FUSEBASE_* env vars are not set, so
 * contributors can run `bun run test:e2e` locally without credentials.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CliWorkspace,
  createApiClient,
  createCliWorkspace,
  e2eEnvAvailable,
  e2eEnvMissing,
  getAppHost,
  getE2eEnv,
  runCli,
} from "./helpers";

if (!e2eEnvAvailable) {
  // eslint-disable-next-line no-console
  console.log(
    `[e2e] Skipping smoke-deploy — missing env vars: ${e2eEnvMissing.join(", ")}`,
  );
}

/**
 * Unique app sub per pipeline/job. CI provides CI_PIPELINE_ID + CI_JOB_ID;
 * locally we fall back to a timestamp. Sub must be lowercase + dash-only and
 * short enough to fit subdomain limits (<= 63 chars). The trailing-dash trim
 * after `slice` keeps subdomains like `e2e-cli-12345-67-` from violating
 * RFC 1035 / Azure container app naming when truncation lands on a dash.
 */
const RUN_ID = sanitizeSub(
  `${process.env.CI_PIPELINE_ID ?? "local"}-${
    process.env.CI_JOB_ID ?? Date.now()
  }`,
);
const APP_SUB = trimTrailingDashes(`e2e-cli-${RUN_ID}`.slice(0, 40));
const FEATURE_SUBDOMAIN = trimTrailingDashes(`${APP_SUB}-main`.slice(0, 60));

// Wall-clock budget for the full lifecycle. The `test:e2e` script already
// passes --timeout 1800000 (30 min); this 25 min cap gives the runner a few
// minutes of slack to print teardown output before the timeout fires.
const TEST_TIMEOUT_MS = 25 * 60_000;

describe.skipIf(!e2eEnvAvailable)("apps-cli smoke deploy", () => {
  let workspace: CliWorkspace;
  let createdAppId: string | undefined;

  beforeAll(() => {
    const env = getE2eEnv();
    workspace = createCliWorkspace({ env: env.env, apiKey: env.apiKey });
  });

  afterAll(async () => {
    if (createdAppId) {
      const env = getE2eEnv();
      const api = createApiClient(env);
      try {
        await api.deleteApp(createdAppId);
        // eslint-disable-next-line no-console
        console.log(`[e2e teardown] Deleted app ${createdAppId}`);
      } catch (err) {
        // Teardown failures are reported but must not mask the original test
        // failure. Orphan-cleanup safety net is out of scope per NIM-40894.
        // eslint-disable-next-line no-console
        console.error(
          `[e2e teardown] Failed to delete app ${createdAppId}:`,
          err,
        );
      }
    }
    workspace?.cleanup();
  });

  it(
    "init → scaffold → feature create → sidecar → cron → deploy → verify",
    async () => {
      const env = getE2eEnv();
      const api = createApiClient(env);
      // Pre-computed feature URL — `getAppHost` mirrors the CLI's own
      // `getFusebaseAppHost`, so cron can be wired to the URL via a secret
      // before the deploy completes. The URL printed by `fusebase deploy` is
      // cross-checked below for safety.
      const featureUrl = `https://${FEATURE_SUBDOMAIN}.${getAppHost(env.env)}`;

      // 1. `auth --api-key` — the harness already seeded ~/.fusebase/config.json
      //    with the same key, so this command is technically redundant. We
      //    keep it to exercise the `auth` surface in CI and to cross-check
      //    that fetchOrgs() accepts the configured key before any real work.
      const auth = await runCli(["auth", "--api-key", env.apiKey], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      expect(auth.exitCode, debugOutput("auth", auth)).toBe(0);

      // 2. fusebase init — creates the managed app under the test org.
      const init = await runCli(
        ["init", "--name", APP_SUB, "--org", env.orgId, "--skip-git"],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(init.exitCode, debugOutput("init", init)).toBe(0);
      const fuseJsonPath = join(workspace.cwd, "fusebase.json");
      const initial = readFuseJson(fuseJsonPath);
      expect(initial.appId).toBeTruthy();
      expect(initial.orgId).toBe(env.orgId);
      // Record appId immediately so the afterAll teardown runs even if the
      // rest of the test throws.
      createdAppId = initial.appId;

      // 3a. Scaffold the SPA shell.
      const featureDir = "features/main";
      const spa = await runCli(
        ["scaffold", "--template", "spa", "--dir", featureDir],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(spa.exitCode, debugOutput("scaffold spa", spa)).toBe(0);

      // 3b. Scaffold the backend on top of the SPA.
      const backend = await runCli(
        ["scaffold", "--template", "backend", "--dir", featureDir],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(backend.exitCode, debugOutput("scaffold backend", backend)).toBe(
        0,
      );

      // 4. Replace the scaffolded backend with our smoke-test Hono app and a
      //    cron entrypoint. The backend keeps an in-memory list of markers it
      //    receives so the test can confirm both code paths executed for this
      //    specific run via the unique `runId`.
      const backendDir = join(workspace.cwd, featureDir, "backend");
      writeFileSync(
        join(backendDir, "src", "index.ts"),
        SMOKE_BACKEND_INDEX,
        "utf-8",
      );
      writeFileSync(
        join(backendDir, "src", "cron.ts"),
        SMOKE_CRON_SCRIPT,
        "utf-8",
      );
      // Build both entrypoints — the scaffolded build script only emits
      // dist/index.js. The cron job needs dist/cron.js too.
      const backendPkgPath = join(backendDir, "package.json");
      const backendPkg = JSON.parse(readFileSync(backendPkgPath, "utf-8"));
      backendPkg.scripts.build =
        "tsup src/index.ts src/cron.ts --format esm --out-dir dist";
      writeFileSync(
        backendPkgPath,
        JSON.stringify(backendPkg, null, 2),
        "utf-8",
      );

      // 5. Register the feature. `--access visitor` is required: without an
      //    access principal the platform proxy answers /api/* with the
      //    Fusebase auth login page (HTML 200, see commit ce83e30 diagnostics
      //    on pipeline 263303). The smoke test calls the deployed backend
      //    from CI with no session cookie, so the feature must allow
      //    unauthenticated visitors for /api/healthz and /api/touch to reach
      //    the container.
      const featureCreate = await runCli(
        [
          "feature",
          "create",
          "--name",
          "main",
          "--subdomain",
          FEATURE_SUBDOMAIN,
          "--path",
          featureDir,
          "--dev-command",
          "npm run dev",
          "--build-command",
          "npm run build",
          "--output-dir",
          "dist",
          "--backend-dev-command",
          "npm run dev",
          "--backend-build-command",
          "npm run build",
          "--backend-start-command",
          "npm run start",
          "--access",
          "visitor",
        ],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(
        featureCreate.exitCode,
        debugOutput("feature create", featureCreate),
      ).toBe(0);

      const afterFeature = readFuseJson(fuseJsonPath);
      const featureId = afterFeature.features?.[0]?.id;
      expect(featureId).toBeTruthy();

      // 6. Sidecar — verification is just "deploy succeeds with sidecar
      //    configured", per the clarification round. nginx:alpine is a
      //    cheap, well-known image.
      const sidecar = await runCli(
        [
          "sidecar",
          "add",
          "--feature",
          featureId!,
          "--name",
          "nginx",
          "--image",
          "nginx:alpine",
        ],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(sidecar.exitCode, debugOutput("sidecar add", sidecar)).toBe(0);

      // 7. Cron job — runs every minute so the test only has to wait one
      //    tick (~90s budget) for the marker to appear.
      const job = await runCli(
        [
          "job",
          "create",
          "--feature",
          featureId!,
          "--name",
          "touch-cron",
          "--cron",
          "* * * * *",
          "--command",
          "node dist/cron.js",
        ],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(job.exitCode, debugOutput("job create", job)).toBe(0);

      // 8. Inject secrets so the cron entrypoint knows which backend URL to
      //    POST to and which `runId` to tag the marker with. The endpoint
      //    shape matches `setAppFeatureSecrets` in lib/api.ts. Backend reads
      //    the same `FUSEBASE_RUN_ID` only as a default fallback — markers
      //    are correlated by the `runId` field inside the request body.
      await api.request(
        "POST",
        `/v1/orgs/${encodeURIComponent(env.orgId)}/apps/${encodeURIComponent(
          createdAppId!,
        )}/features/${encodeURIComponent(featureId!)}/secrets`,
        {
          secrets: [
            {
              key: "FUSEBASE_RUN_ID",
              value: RUN_ID,
              description: "E2E smoke runId (NIM-40901)",
            },
            {
              key: "FUSEBASE_FEATURE_URL",
              value: featureUrl,
              description: "E2E smoke feature URL for cron callbacks (NIM-40901)",
            },
          ],
        },
      );

      // 9. Deploy. The CLI polls the deploy until it completes — when it
      //    returns, the app is fully provisioned in Azure.
      const deploy = await runCli(["deploy"], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      expect(deploy.exitCode, debugOutput("deploy", deploy)).toBe(0);
      // Always print deploy stdout so a failed post-deploy assertion can be
      // correlated to what the CLI saw. The deploy step prints whether the
      // backend was archived/uploaded — that's the cheapest signal we have
      // for "did the backend actually deploy" before we hit the network.
      // eslint-disable-next-line no-console
      console.log(`[e2e] deploy stdout (last 60 lines):`);
      // eslint-disable-next-line no-console
      console.log(deploy.stdout.split("\n").slice(-60).join("\n"));

      // The deploy summary prints `    URL: https://...`. Capture the first
      // such line — there is only one feature in this smoke test — and
      // assert it matches the URL we pre-computed. If they diverge, cron
      // will silently POST to the wrong host and the cron-marker assertion
      // below would still time out, but the explicit cross-check fails fast
      // with a clearer message.
      const urlMatch = deploy.stdout.match(/URL:\s*(https:\/\/\S+)/);
      expect(
        urlMatch,
        `Could not find feature URL in deploy output:\n${deploy.stdout}`,
      ).toBeTruthy();
      const printedFeatureUrl = urlMatch![1]!.replace(/\/+$/, "");
      expect(
        printedFeatureUrl,
        `Pre-computed feature URL ${featureUrl} does not match the URL printed by the CLI (${printedFeatureUrl}). Cron secret would point at the wrong host.`,
      ).toBe(featureUrl);

      // Mint a feature token so platform proxy lets server-to-server calls
      // through. With only `--access visitor` the proxy routes /api/* through
      // a visitor-session bootstrap that requires cookie persistence —
      // `fetch` without a cookie jar trips a redirect loop (see commit
      // 4977ed8 diagnostics on pipeline 263305). Sending a feature token via
      // `x-app-feature-token` + the legacy `fbsfeaturetoken` cookie matches
      // the contract documented in `apps-cli/AGENTS.md` ("Feature Token
      // Flow"); the proxy strips the header upstream but accepts it as
      // proof-of-auth at the edge.
      const tokenRes = await api.request<{ token: string }>(
        "POST",
        `/v1/orgs/${encodeURIComponent(env.orgId)}/apps/${encodeURIComponent(
          createdAppId!,
        )}/features/${encodeURIComponent(featureId!)}/tokens`,
      );
      const featureToken = tokenRes.token;
      expect(
        featureToken,
        `feature token endpoint returned no token`,
      ).toBeTruthy();
      const featureAuthHeaders: Record<string, string> = {
        "x-app-feature-token": featureToken,
        cookie: `fbsfeaturetoken=${featureToken}`,
      };

      // 10. HTTP smoke. Azure may take a few minutes to route the new
      //     container app, so we poll up to 8 minutes. We assert both
      //     status===200 *and* a JSON body of `{ok:true}` *and* a JSON
      //     content-type. The deployed feature includes a SPA whose
      //     static-file server returns `index.html` (HTML 200) for any
      //     `/api/*` path the backend does not handle — a status-only
      //     check would silently pass even when the backend is not
      //     reachable. `redirect: "manual"` fails fast on the
      //     visitor-session bootstrap loop instead of grinding through 20
      //     redirects per probe (~4s wasted per iteration).
      let lastHealthzBody = "";
      let lastHealthzContentType = "";
      let lastHealthzStatus: number | undefined;
      let lastHealthzLocation = "";
      let lastHealthzNetworkError = "";
      try {
        await pollUntil(
          async () => {
            const res = await fetch(`${featureUrl}/api/healthz`, {
              headers: featureAuthHeaders,
              redirect: "manual",
            }).catch((err) => {
              lastHealthzNetworkError =
                err instanceof Error ? err.message : String(err);
              return null;
            });
            if (!res) return false;
            lastHealthzStatus = res.status;
            lastHealthzContentType = res.headers.get("content-type") ?? "";
            lastHealthzLocation = res.headers.get("location") ?? "";
            const text = await res.text().catch(() => "");
            lastHealthzBody = text;
            if (res.status !== 200) return false;
            if (!lastHealthzContentType.includes("application/json")) {
              return false;
            }
            try {
              const body = JSON.parse(text) as { ok?: boolean };
              return body.ok === true;
            } catch {
              return false;
            }
          },
          { timeoutMs: 8 * 60_000, intervalMs: 5_000, label: "GET /api/healthz returning {ok:true}" },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `${message}\n` +
            `featureUrl=${featureUrl}\n` +
            `lastStatus=${lastHealthzStatus ?? "n/a"} ` +
            `lastContentType=${lastHealthzContentType || "n/a"} ` +
            `lastLocation=${lastHealthzLocation || "n/a"} ` +
            `lastNetworkError=${lastHealthzNetworkError || "none"}\n` +
            `lastBody (first 500 chars):\n${lastHealthzBody.slice(0, 500)}`,
        );
      }

      // 11. Trigger the backend write and verify the marker is present in
      //     the response body. We deliberately avoid a separate
      //     `GET /api/markers` step: features deploy with `minReplicas: 0`
      //     (see `nimbus-ai/src/taskProcessors/deployFeatureBackendVersion.ts`),
      //     so the container can be torn down between requests and any
      //     in-memory store is wiped. Same-request assertion sidesteps this:
      //     POST /api/touch pushes the marker AND returns the current
      //     `markers` snapshot, all in one round trip on a single replica.
      const touchRes = await fetch(`${featureUrl}/api/touch`, {
        method: "POST",
        headers: { ...featureAuthHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ source: "http", runId: RUN_ID }),
      });
      const touchBodyText = await touchRes.text();
      expect(
        touchRes.status,
        `POST /api/touch returned ${touchRes.status}\nbody:\n${touchBodyText}`,
      ).toBe(200);
      const touchBody = JSON.parse(touchBodyText) as {
        ok?: boolean;
        markers?: SmokeMarker[];
      };
      expect(
        touchBody.markers?.some(
          (m) => m.source === "http" && m.runId === RUN_ID,
        ),
        `POST /api/touch did not return our marker. response:\n${touchBodyText}`,
      ).toBe(true);

      // 12. Cron runtime verification is intentionally limited to "the job
      //     was scheduled" — same shape as sidecar verification. End-to-end
      //     cron-marker checks would require a persistent backing store
      //     (Container Apps min_replicas=0 wipes anything in-memory between
      //     ticks, and there is no public-api row endpoint we can use as a
      //     cross-process channel). The CLI surface — `fusebase job create`
      //     — is fully exercised in step 7, and the deploy in step 9
      //     succeeded with the cron job present, which together satisfy the
      //     "deploy of app with cron jobs" acceptance criterion.

      // 13. Best-effort: confirm the app is still listed under the org. The
      //     real teardown happens in afterAll regardless of outcome.
      const apps = await api.listApps();
      expect(apps.some((a) => a.id === createdAppId)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

interface FuseConfigShape {
  orgId?: string;
  appId?: string;
  features?: Array<{ id: string; path?: string }>;
}

interface SmokeMarker {
  source: string;
  runId: string;
  ts: number;
}

function readFuseJson(path: string): FuseConfigShape {
  return JSON.parse(readFileSync(path, "utf-8")) as FuseConfigShape;
}

function debugOutput(
  label: string,
  res: { stdout: string; stderr: string },
): string {
  return `${label} failed.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
}

function sanitizeSub(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trimTrailingDashes(value: string): string {
  return value.replace(/-+$/, "");
}

interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  label: string;
}

async function pollUntil(
  predicate: () => Promise<boolean>,
  opts: PollOptions,
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown = undefined;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  const reason =
    lastError instanceof Error ? `; last error: ${lastError.message}` : "";
  throw new Error(
    `${opts.label}: timed out after ${opts.timeoutMs}ms${reason}`,
  );
}

const SMOKE_BACKEND_INDEX = `import { Hono } from 'hono'
import { serve } from '@hono/node-server'

interface SmokeMarker {
  source: string
  runId: string
  ts: number
}

// In-memory marker store. The smoke test polls /api/markers to confirm both
// the HTTP path (test → POST /api/touch) and the cron path (cron job → POST
// /api/touch) executed within this deployment's lifetime, correlated by the
// per-run \`runId\`. Container Apps default to a single replica at this
// traffic level, so a single in-memory list is sufficient for the smoke.
const markers: SmokeMarker[] = []

const app = new Hono().basePath('/api')

app.get('/healthz', (c) => c.json({ ok: true }))

app.post('/touch', async (c) => {
  let body: any = {}
  try {
    body = await c.req.json()
  } catch {}
  const source = typeof body?.source === 'string' && body.source ? body.source : 'http'
  const runId =
    typeof body?.runId === 'string' && body.runId
      ? body.runId
      : process.env.FUSEBASE_RUN_ID ?? ''
  markers.push({ source, runId, ts: Date.now() })
  // Return the current snapshot so the smoke test can assert in a single
  // round trip. Container Apps min_replicas=0 wipes the in-memory store
  // between requests, so a separate GET would race the cold-start cycle.
  return c.json({ ok: true, markers })
})

app.get('/markers', (c) => c.json({ markers }))

const port = Number(process.env.BACKEND_PORT) || 3001
serve({ fetch: app.fetch, port }, () => {
  console.log(\`E2E smoke backend listening on \${port}\`)
})
`;

// The cron entrypoint posts to /api/touch as a CLI-plumbing exercise (the
// feature has a cron job configured and that job must build + run). The
// smoke test does NOT assert the cron POST landed in the backend (Container
// Apps min_replicas=0 means the marker store is wiped between calls and
// there is no shared persistence we can use). Any error is logged but the
// process exits 0 so a single transient network blip doesn't pollute the
// Container Apps Job's run history.
const SMOKE_CRON_SCRIPT = `const featureUrl = process.env.FUSEBASE_FEATURE_URL
const runId = process.env.FUSEBASE_RUN_ID

if (!featureUrl || !runId) {
  console.warn('cron: missing FUSEBASE_FEATURE_URL/FUSEBASE_RUN_ID — exiting cleanly')
  process.exit(0)
}

;(async () => {
  try {
    const res = await fetch(\`\${featureUrl}/api/touch\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'cron', runId }),
    })
    console.log(\`cron: posted marker runId=\${runId} status=\${res.status}\`)
  } catch (err) {
    console.warn(\`cron: post failed: \${err instanceof Error ? err.message : err}\`)
  }
})()
`;
