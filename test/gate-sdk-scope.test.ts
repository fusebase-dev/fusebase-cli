import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  analyzeGateSdkOperations,
  collectUsedOperations,
  extractAllowlistFromSdk,
  loadTsProgram,
} from "../lib/gate-sdk-used-operations.ts";

describe("collectUsedOperations scoped by feature path", () => {
  it("collects only Gate operations from files under the requested scope root", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-scope-"));
    const featureADir = join(dir, "features", "a");
    const featureBDir = join(dir, "features", "b");
    mkdirSync(featureADir, { recursive: true });
    mkdirSync(featureBDir, { recursive: true });

    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: false,
          },
          include: ["features/**/*.ts"],
        },
        null,
        2,
      ),
    );

    const sharedPrelude = `
      class TokensApi {
        listTokens() {}
        createToken() {}
      }
    `;

    writeFileSync(
      join(featureADir, "index.ts"),
      `${sharedPrelude}
      const api = new TokensApi();
      api.listTokens();
      `,
    );

    writeFileSync(
      join(featureBDir, "index.ts"),
      `${sharedPrelude}
      const api = new TokensApi();
      api.createToken();
      `,
    );

    const loaded = loadTsProgram(dir);
    expect(loaded).not.toBeNull();

    const used = collectUsedOperations(
      loaded!.program,
      new Set(["listTokens", "createToken"]),
      new Set(["TokensApi"]),
      featureADir,
    );

    expect([...used]).toEqual(["listTokens"]);

    rmSync(dir, { recursive: true });
  });

  it("recognizes SDK operations for API classes discovered from dist/apis", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-access-"));
    const featureDir = join(dir, "features", "membership");
    const sdkApisDir = join(dir, "node_modules", "@fusebase", "fusebase-gate-sdk", "dist", "apis");
    mkdirSync(featureDir, { recursive: true });
    mkdirSync(sdkApisDir, { recursive: true });

    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: false,
          },
          include: ["features/**/*.ts"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(sdkApisDir, "EmailsApi.js"),
      `
      class EmailsApi {
        async sendOrgEmail() {
          return this.client.request({
            method: "POST",
            path: "/:orgId/email",
            opId: "sendOrgEmail",
          });
        }
      }
      `,
    );

    writeFileSync(join(dir, "node_modules", "@fusebase", "fusebase-gate-sdk", "package.json"), `{"version":"0.0.0-test"}`);

    writeFileSync(
      join(featureDir, "index.ts"),
      `
      class EmailsApi {
        sendOrgEmail() {}
      }

      const api = new EmailsApi();
      api.sendOrgEmail();
      `,
    );

    const loaded = loadTsProgram(dir);
    expect(loaded).not.toBeNull();
    const sdk = await extractAllowlistFromSdk(
      join(dir, "node_modules", "@fusebase", "fusebase-gate-sdk"),
    );

    const used = collectUsedOperations(
      loaded!.program,
      new Set(sdk.opIds),
      new Set(sdk.apiClassNames),
      featureDir,
    );

    expect(sdk.apiClassNames).toEqual(["EmailsApi"]);
    expect([...used]).toEqual(["sendOrgEmail"]);

    rmSync(dir, { recursive: true });
  });

  it("prefers feature-local tsconfig when analyzing a scoped feature", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-feature-tsconfig-"));
    const featureDir = join(dir, "features", "workspace-permissions");
    const featureSrcDir = join(featureDir, "src");
    const sdkApisDir = join(
      dir,
      "node_modules",
      "@fusebase",
      "fusebase-gate-sdk",
      "dist",
      "apis",
    );
    mkdirSync(featureSrcDir, { recursive: true });
    mkdirSync(sdkApisDir, { recursive: true });

    // Root tsconfig intentionally excludes feature files.
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: [],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(featureDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
            baseUrl: ".",
            paths: {
              "@/*": ["./src/*"],
            },
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(sdkApisDir, "WorkspacesApi.js"),
      `
      class WorkspacesApi {
        async listWorkspaces() {
          return this.client.request({
            method: "GET",
            path: "/:orgId/workspaces",
            opId: "listWorkspaces",
          });
        }
      }
      `,
    );

    writeFileSync(
      join(dir, "node_modules", "@fusebase", "fusebase-gate-sdk", "package.json"),
      `{"version":"0.0.0-test"}`,
    );

    writeFileSync(
      join(featureSrcDir, "api.ts"),
      `
      class WorkspacesApi {
        listWorkspaces() {}
      }

      export function createWorkspacesApi(): WorkspacesApi {
        return new WorkspacesApi();
      }
      `,
    );

    writeFileSync(
      join(featureSrcDir, "index.ts"),
      `
      import { createWorkspacesApi } from "@/api";

      const api = createWorkspacesApi();
      api.listWorkspaces();
      `,
    );

    const result = await analyzeGateSdkOperations({
      projectRoot: dir,
      scopeRoot: featureDir,
    });

    expect(result.usedOps).toEqual(["listWorkspaces"]);
    expect(result.tsconfig).toBe(join(featureDir, "tsconfig.json"));

    rmSync(dir, { recursive: true });
  });
});
