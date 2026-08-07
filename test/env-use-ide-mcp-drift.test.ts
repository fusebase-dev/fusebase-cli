import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/**
 * NIM-43140: IDE MCP configs bake the environment's bearer tokens in as
 * literals, so `env use <other>` used to leave the IDE authenticating as the
 * previous environment with no warning.
 */

const CLI_ENTRY = join(import.meta.dir, "..", "index.ts");

function envFileFor(name: string): string {
  return [
    `DASHBOARDS_MCP_URL=https://dashboards-mcp.example.test/mcp`,
    `DASHBOARDS_MCP_TOKEN=dash-${name}`,
    `GATE_MCP_URL=https://gate-mcp.example.test/mcp`,
    `GATE_MCP_TOKEN=gate-${name}`,
    "",
  ].join("\n");
}

function mcpJsonFor(name: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "fusebase-dashboards": {
          type: "http",
          url: "https://dashboards-mcp.example.test/mcp",
          headers: { Authorization: `Bearer dash-${name}` },
        },
        "fusebase-gate": {
          type: "http",
          url: "https://gate-mcp.example.test/mcp",
          headers: { Authorization: `Bearer gate-${name}` },
        },
      },
    },
    null,
    2,
  );
}

function codexTomlFor(name: string): string {
  return [
    `[mcp_servers."fusebase-gate"]`,
    `enabled = true`,
    `url = "https://gate-mcp.example.test/mcp"`,
    `http_headers = { Authorization = "Bearer gate-${name}" }`,
    "",
  ].join("\n");
}

describe("env use / env status vs IDE MCP configs", () => {
  let dir: string;
  let home: string;
  let project: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fuse-env-ide-drift-"));
    home = join(dir, "home");
    project = join(dir, "project");
    mkdirSync(join(home, ".fusebase"), { recursive: true });
    mkdirSync(join(project, "environments"), { recursive: true });
    writeFileSync(
      join(home, ".fusebase", "config.json"),
      JSON.stringify({ env: "prod", apiKey: "legacy-key", flags: ["environments"] }),
      "utf-8",
    );
    writeFileSync(
      join(project, "fusebase.json"),
      JSON.stringify({ orgId: "org-1", productId: "prod-1", apps: [] }, null, 2),
      "utf-8",
    );

    for (const [name, orgId] of [
      ["beta", "org-beta"],
      ["prod", "org-prod"],
    ]) {
      writeFileSync(
        join(project, "environments", `${name}.json`),
        JSON.stringify({ backend: "prod", orgId, productId: `product-${name}` }, null, 2),
        "utf-8",
      );
      writeFileSync(join(project, `.env.${name}`), envFileFor(name!), "utf-8");
    }

    // Configs were generated while "beta" was active.
    writeFileSync(join(project, ".env"), envFileFor("beta"), "utf-8");
    writeFileSync(join(project, ".mcp.json"), mcpJsonFor("beta"), "utf-8");
    mkdirSync(join(project, ".cursor"), { recursive: true });
    writeFileSync(join(project, ".cursor", "mcp.json"), mcpJsonFor("beta"), "utf-8");
    mkdirSync(join(project, ".codex"), { recursive: true });
    writeFileSync(join(project, ".codex", "config.toml"), codexTomlFor("beta"), "utf-8");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", CLI_ENTRY, ...args], {
      cwd: project,
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
    return { stdout, stderr, exitCode: await proc.exited };
  }

  it("env use warns when IDE MCP configs still hold the previous env's tokens", async () => {
    const result = await runCli(["env", "use", "prod"]);
    expect(result.exitCode).toBe(0);
    // .env followed the switch...
    expect(readFileSync(join(project, ".env"), "utf-8")).toContain("GATE_MCP_TOKEN=gate-prod");
    // ...the IDE configs did not, and the CLI says so with the fix command.
    const output = result.stdout + result.stderr;
    expect(output).toContain(".mcp.json");
    expect(output).toContain(".cursor/mcp.json");
    expect(output).toContain(".codex/config.toml");
    expect(output).toContain("fusebase config ide --force");
  });

  it("env status reports the divergence", async () => {
    const result = await runCli(["env", "status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ide mcp:   STALE");
    expect(result.stdout).toContain("fusebase-gate");
  });

  it("both go quiet once the configs match the active env", async () => {
    writeFileSync(join(project, ".mcp.json"), mcpJsonFor("prod"), "utf-8");
    writeFileSync(join(project, ".cursor", "mcp.json"), mcpJsonFor("prod"), "utf-8");
    writeFileSync(join(project, ".codex", "config.toml"), codexTomlFor("prod"), "utf-8");

    const status = await runCli(["env", "status"]);
    expect(status.stdout).toContain("ide mcp:   ok");

    const use = await runCli(["env", "use", "prod"]);
    expect(use.stdout + use.stderr).not.toContain("fusebase config ide --force");
  });
});
