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
 * unique `runId` (the per-pipeline `APP_SUB`). This avoids depending on a
 * public-api dashboard-rows endpoint that does not exist (see code review on
 * MR !66) and keeps assertions correlated to the current run, not leftover
 * data from a prior failed run.
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

      // 5. Register the feature.
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

      // 10. HTTP smoke. Azure may take a few minutes to route the new
      //     container app, so we poll up to 5 minutes.
      await pollUntil(
        async () => {
          const res = await fetch(`${featureUrl}/api/healthz`).catch(
            () => null,
          );
          return res?.status === 200;
        },
        { timeoutMs: 5 * 60_000, intervalMs: 5_000, label: "GET /api/healthz" },
      );

      // 11. Trigger the backend write and verify the marker landed in the
      //     in-memory store *with this run's runId*.
      const touchRes = await fetch(`${featureUrl}/api/touch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "http", runId: RUN_ID }),
      });
      expect(touchRes.status).toBe(200);

      await pollUntil(
        async () => {
          const markers = await fetchMarkers(featureUrl).catch(() => []);
          return markers.some(
            (m) => m.source === "http" && m.runId === RUN_ID,
          );
        },
        {
          timeoutMs: 60_000,
          intervalMs: 3_000,
          label: `marker source=http runId=${RUN_ID}`,
        },
      );

      // 12. Wait for the cron tick. The cron entrypoint posts to the same
      //     `/api/touch` endpoint with `source=cron` and the runId injected
      //     via FUSEBASE_RUN_ID. Asserting on the runId guarantees we are
      //     looking at THIS run, not stale state from a prior failed run.
      await pollUntil(
        async () => {
          const markers = await fetchMarkers(featureUrl).catch(() => []);
          return markers.some(
            (m) => m.source === "cron" && m.runId === RUN_ID,
          );
        },
        {
          timeoutMs: 90_000,
          intervalMs: 5_000,
          label: `marker source=cron runId=${RUN_ID}`,
        },
      );

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

async function fetchMarkers(featureUrl: string): Promise<SmokeMarker[]> {
  const res = await fetch(`${featureUrl}/api/markers`);
  if (!res.ok) return [];
  const body = (await res.json()) as { markers?: SmokeMarker[] } | undefined;
  return Array.isArray(body?.markers) ? body!.markers! : [];
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
  return c.json({ ok: true })
})

app.get('/markers', (c) => c.json({ markers }))

const port = Number(process.env.BACKEND_PORT) || 3001
serve({ fetch: app.fetch, port }, () => {
  console.log(\`E2E smoke backend listening on \${port}\`)
})
`;

const SMOKE_CRON_SCRIPT = `const featureUrl = process.env.FUSEBASE_FEATURE_URL
const runId = process.env.FUSEBASE_RUN_ID

if (!featureUrl || !runId) {
  console.error('cron: missing FUSEBASE_FEATURE_URL/FUSEBASE_RUN_ID')
  process.exit(1)
}

;(async () => {
  const res = await fetch(\`\${featureUrl}/api/touch\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'cron', runId }),
  })
  if (!res.ok) {
    console.error(
      \`cron: backend write failed \${res.status} \${await res.text().catch(() => '')}\`,
    )
    process.exit(1)
  }
  console.log(\`cron: posted marker runId=\${runId}\`)
})()
`;
