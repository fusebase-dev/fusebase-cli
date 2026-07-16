import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * Spawn-based tests for the `fusebase env` command group. Uses an isolated
 * HOME (global config with the `environments` flag) and a temp project, the
 * same pattern as isolated-sql-bundle.test.ts.
 */

const CLI_ENTRY = join(import.meta.dir, "..", "index.ts");

describe("fusebase env commands", () => {
  let dir: string;
  let home: string;
  let project: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fuse-env-cmd-"));
    home = join(dir, "home");
    project = join(dir, "project");
    mkdirSync(join(home, ".fusebase"), { recursive: true });
    mkdirSync(join(project, "apps", "portal"), { recursive: true });
    writeFileSync(
      join(home, ".fusebase", "config.json"),
      JSON.stringify({
        env: "dev",
        apiKey: "legacy-key",
        flags: ["environments"],
      }),
      "utf-8",
    );
    writeFileSync(
      join(project, "fusebase.json"),
      JSON.stringify(
        {
          orgId: "org-dev-1",
          productId: "prod-dev-1",
          apps: [
            {
              id: "app-123",
              subdomain: "portal",
              name: "Portal",
              path: "apps/portal",
              isolatedStores: {
                sql: [
                  {
                    alias: "portal",
                    storeId: "11111111-2222-3333-4444-555555555555",
                  },
                ],
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(join(project, ".env"), "GATE_MCP_TOKEN=tok-dev\n", "utf-8");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function runCli(
    args: string[],
    options?: { cwd?: string },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", CLI_ENTRY, ...args], {
      cwd: options?.cwd ?? project,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        FUSEBASE_DISABLE_ANALYTICS: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  it("env init adopts the current context as the first environment", async () => {
    const result = await runCli(["env", "init"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Active environment: dev");

    const lockfile = JSON.parse(
      readFileSync(join(project, "environments", "dev.json"), "utf-8"),
    );
    expect(lockfile.backend).toBe("dev");
    expect(lockfile.orgId).toBe("org-dev-1");
    expect(lockfile.productId).toBe("prod-dev-1");
    expect(lockfile.apps.portal.id).toBe("app-123");
    expect(lockfile.apps.portal.stores.portal).toBe(
      "11111111-2222-3333-4444-555555555555",
    );

    // .env copied into the per-env dotenv, .env materialized with header.
    expect(readFileSync(join(project, ".env.dev"), "utf-8")).toContain(
      "GATE_MCP_TOKEN=tok-dev",
    );
    expect(readFileSync(join(project, ".env"), "utf-8")).toContain(
      "Generated from .env.dev",
    );

    // State + gitignore hygiene.
    expect(
      JSON.parse(
        readFileSync(join(project, ".fusebase", "state.json"), "utf-8"),
      ).activeEnvironment,
    ).toBe("dev");
    const gitignore = readFileSync(join(project, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".env.*");
    expect(gitignore).toContain(".fusebase/");
  });

  it("env init refuses to run twice", async () => {
    const result = await runCli(["env", "init"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("env add creates a protected prod environment and refuses duplicates", async () => {
    const result = await runCli([
      "env",
      "add",
      "prod-beta",
      "--backend",
      "prod",
      "--org",
      "org-prod-9",
      "--subdomain-suffix",
      "-beta",
      "--protected",
    ]);
    expect(result.exitCode).toBe(0);
    const lockfile = JSON.parse(
      readFileSync(join(project, "environments", "prod-beta.json"), "utf-8"),
    );
    expect(lockfile.backend).toBe("prod");
    expect(lockfile.orgId).toBe("org-prod-9");
    expect(lockfile.protected).toBe(true);
    expect(lockfile.subdomainSuffix).toBe("-beta");

    const dup = await runCli([
      "env",
      "add",
      "prod-beta",
      "--backend",
      "prod",
      "--org",
      "org-prod-9",
    ]);
    expect(dup.exitCode).toBe(1);
    expect(dup.stderr).toContain("already exists");
  });

  it("env add without options in non-TTY errors with interactive-mode hint", async () => {
    const result = await runCli(["env", "add"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing <name>, --backend, --org");
    expect(result.stderr).toContain("interactive setup");
  });

  it("env list shows environments with the active marker", async () => {
    const result = await runCli(["env", "list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/\* dev\s+backend=dev\s+org=org-dev-1/);
    expect(result.stdout).toContain("prod-beta");
    expect(result.stdout).toContain("[protected]");
  });

  it("env use switches the active environment and warns about stale .env", async () => {
    const result = await runCli(["env", "use", "prod-beta"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Active environment: prod-beta");
    expect(result.stdout).toContain("PROTECTED");
    // Non-TTY: no prompts; warnings instead.
    expect(result.stderr).toContain(".env.prod-beta does not exist");
    expect(result.stderr).toContain("previous environment");
    expect(
      JSON.parse(
        readFileSync(join(project, ".fusebase", "state.json"), "utf-8"),
      ).activeEnvironment,
    ).toBe("prod-beta");
  });

  it("env status reports unresolved apps without borrowing fusebase.json ids", async () => {
    const result = await runCli(["env", "status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Environment: prod-beta");
    expect(result.stdout).toContain("product:   (unresolved — run deploy)");
    expect(result.stdout).toContain("portal: unresolved (run deploy)");
    expect(result.stdout).toContain("is not bound to this environment");
    expect(result.stdout).toContain(".env.prod-beta missing");
  });

  it("env status --env <name> targets a named environment", async () => {
    const result = await runCli(["env", "status", "--env", "dev"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Environment: dev");
    expect(result.stdout).toContain("selected via --env option");
    expect(result.stdout).toContain("portal: id=app-123");
  });

  it("env clone clears platform ids and warns on same backend+org", async () => {
    const result = await runCli([
      "env",
      "clone",
      "prod-beta",
      "prod-qa",
      "--org",
      "org-prod-9",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("collide on subdomains");
    const lockfile = JSON.parse(
      readFileSync(join(project, "environments", "prod-qa.json"), "utf-8"),
    );
    expect(lockfile.backend).toBe("prod");
    expect(lockfile.orgId).toBe("org-prod-9");
    expect(lockfile.protected).toBeUndefined();
  });

  it("env tokens errors on an environment without productId", async () => {
    const result = await runCli(["env", "tokens", "--env", "prod-qa"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("has no productId yet");
  });

  it("env strip records orphan ids into the home env, then cleans fusebase.json", async () => {
    const project3 = join(dir, "project3");
    mkdirSync(join(project3, "environments"), { recursive: true });
    mkdirSync(join(project3, "apps", "portal"), { recursive: true });
    // Adopted without --strip: ids still in fusebase.json, lockfile without them.
    writeFileSync(
      join(project3, "fusebase.json"),
      JSON.stringify({
        orgId: "org-dev-1",
        productId: "prod-dev-1",
        apps: [
          {
            id: "app-999",
            subdomain: "portal",
            path: "apps/portal",
            isolatedStores: { sql: [{ alias: "portal", storeId: "store-uuid-9" }] },
          },
        ],
      }),
      "utf-8",
    );
    writeFileSync(
      join(project3, "environments", "prod.json"),
      JSON.stringify({ backend: "prod", orgId: "org-dev-1", productId: "prod-dev-1" }),
      "utf-8",
    );
    writeFileSync(
      join(project3, "environments", "other.json"),
      JSON.stringify({ backend: "prod", orgId: "org-other" }),
      "utf-8",
    );

    const result = await runCli(["env", "strip"], { cwd: project3 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Recorded 1 unrecorded id(s) into environments/prod.json");

    const lockfile = JSON.parse(
      readFileSync(join(project3, "environments", "prod.json"), "utf-8"),
    );
    expect(lockfile.apps.portal.id).toBe("app-999");
    expect(lockfile.apps.portal.stores.portal).toBe("store-uuid-9");

    const fuse = JSON.parse(readFileSync(join(project3, "fusebase.json"), "utf-8"));
    expect(fuse.apps[0].id).toBeUndefined();
    expect(fuse.apps[0].isolatedStores.sql[0].storeId).toBeUndefined();

    // Idempotent: second run has nothing to record.
    const again = await runCli(["env", "strip"], { cwd: project3 });
    expect(again.exitCode).toBe(0);
    expect(again.stdout).not.toContain("Recorded");
  });

  it("env init --strip removes env-specific ids from fusebase.json", async () => {
    const project2 = join(dir, "project2");
    mkdirSync(join(project2, "apps", "portal"), { recursive: true });
    writeFileSync(
      join(project2, "fusebase.json"),
      readFileSync(join(project, "fusebase.json"), "utf-8"),
      "utf-8",
    );
    const result = await runCli(["env", "init", "--strip"], { cwd: project2 });
    expect(result.exitCode).toBe(0);

    const fuseConfig = JSON.parse(
      readFileSync(join(project2, "fusebase.json"), "utf-8"),
    );
    expect(fuseConfig.apps[0].id).toBeUndefined();
    expect(fuseConfig.apps[0].subdomain).toBe("portal");
    expect(fuseConfig.apps[0].isolatedStores.sql[0].storeId).toBeUndefined();
    expect(fuseConfig.apps[0].isolatedStores.sql[0].alias).toBe("portal");

    // Ids moved into the lockfile.
    const lockfile = JSON.parse(
      readFileSync(join(project2, "environments", "dev.json"), "utf-8"),
    );
    expect(lockfile.apps.portal.id).toBe("app-123");
  });

  it("env remove deletes local files, clears active state, keeps platform note", async () => {
    // prod-qa exists from the clone test; make it active first.
    await runCli(["env", "use", "prod-qa"]);
    writeFileSync(join(project, ".env.prod-qa"), "GATE_MCP_TOKEN=x\n", "utf-8");

    // Non-TTY without --yes refuses.
    const refused = await runCli(["env", "remove", "prod-qa"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("--yes");

    const result = await runCli(["env", "remove", "prod-qa", "--yes"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Removed");
    expect(existsSync(join(project, "environments", "prod-qa.json"))).toBe(false);
    expect(existsSync(join(project, ".env.prod-qa"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(project, ".fusebase", "state.json"), "utf-8"))
        .activeEnvironment,
    ).toBeUndefined();

    const missing = await runCli(["env", "remove", "prod-qa", "--yes"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("not found");
  });

  it("env subcommands require the environments flag", async () => {
    const bareHome = join(dir, "home-noflag");
    mkdirSync(join(bareHome, ".fusebase"), { recursive: true });
    writeFileSync(
      join(bareHome, ".fusebase", "config.json"),
      JSON.stringify({ env: "dev", apiKey: "k" }),
      "utf-8",
    );
    const proc = Bun.spawn(["bun", CLI_ENTRY, "env", "list"], {
      cwd: project,
      env: {
        ...process.env,
        HOME: bareHome,
        USERPROFILE: bareHome,
        FUSEBASE_DISABLE_ANALYTICS: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
    expect(stderr).toContain("config set-flag environments");
  });
});
