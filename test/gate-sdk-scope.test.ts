import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  analyzeGateSdkOperations,
  collectTrustedRuntimeContextUsage,
  collectUsedOperations,
  extractAllowlistFromSdk,
  loadTsProgram,
} from "../lib/gate-sdk-used-operations.ts";

describe("collectUsedOperations scoped by app path", () => {
  it("collects only Gate operations from files under the requested scope root", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-scope-"));
    const appADir = join(dir, "apps", "a");
    const appBDir = join(dir, "apps", "b");
    mkdirSync(appADir, { recursive: true });
    mkdirSync(appBDir, { recursive: true });

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
          include: ["apps/**/*.ts"],
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
      join(appADir, "index.ts"),
      `${sharedPrelude}
      const api = new TokensApi();
      api.listTokens();
      `,
    );

    writeFileSync(
      join(appBDir, "index.ts"),
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
      appADir,
    );

    expect([...used]).toEqual(["listTokens"]);

    rmSync(dir, { recursive: true });
  });

  it("recognizes SDK operations for API classes discovered from dist/apis", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-access-"));
    const appDir = join(dir, "apps", "membership");
    const sdkApisDir = join(dir, "node_modules", "@fusebase", "fusebase-gate-sdk", "dist", "apis");
    mkdirSync(appDir, { recursive: true });
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
          include: ["apps/**/*.ts"],
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
      join(appDir, "index.ts"),
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
      appDir,
    );

    expect(sdk.apiClassNames).toEqual(["EmailsApi"]);
    expect([...used]).toEqual(["sendOrgEmail"]);

    rmSync(dir, { recursive: true });
  });

  it("prefers app-local tsconfig when analyzing a scoped app", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-app-tsconfig-"));
    const appDir = join(dir, "apps", "workspace-permissions");
    const appSrcDir = join(appDir, "src");
    const sdkApisDir = join(
      dir,
      "node_modules",
      "@fusebase",
      "fusebase-gate-sdk",
      "dist",
      "apis",
    );
    mkdirSync(appSrcDir, { recursive: true });
    mkdirSync(sdkApisDir, { recursive: true });

    // Root tsconfig intentionally excludes app files.
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
      join(appDir, "tsconfig.json"),
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
      join(appSrcDir, "api.ts"),
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
      join(appSrcDir, "index.ts"),
      `
      import { createWorkspacesApi } from "@/api";

      const api = createWorkspacesApi();
      api.listWorkspaces();
      `,
    );

    const result = await analyzeGateSdkOperations({
      projectRoot: dir,
      scopeRoot: appDir,
    });

    expect(result.usedOps).toEqual(["listWorkspaces"]);
    expect(result.tsconfig).toBe(join(appDir, "tsconfig.json"));

    rmSync(dir, { recursive: true });
  });

  it("supports optional chaining and string element access for SDK calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-call-shapes-"));
    const appDir = join(dir, "apps", "calls");
    mkdirSync(appDir, { recursive: true });

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
          include: ["apps/**/*.ts"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(appDir, "index.ts"),
      `
      class NotesApi {
        listWorkspaceNotes() {}
        listWorkspaceNoteFolders() {}
      }

      const api = new NotesApi();
      api?.listWorkspaceNotes();
      api["listWorkspaceNoteFolders"]();
      `,
    );

    const loaded = loadTsProgram(dir);
    expect(loaded).not.toBeNull();

    const used = collectUsedOperations(
      loaded!.program,
      new Set(["listWorkspaceNotes", "listWorkspaceNoteFolders"]),
      new Set(["NotesApi"]),
      appDir,
    );

    expect([...used].sort()).toEqual([
      "listWorkspaceNoteFolders",
      "listWorkspaceNotes",
    ]);

    rmSync(dir, { recursive: true });
  });

  it("falls back to tsconfig.app and app-local node_modules SDK", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-app-sdk-root-"));
    const appDir = join(dir, "apps", "workspace-permissions");
    const appSrcDir = join(appDir, "src");
    const appSdkApisDir = join(
      appDir,
      "node_modules",
      "@fusebase",
      "fusebase-gate-sdk",
      "dist",
      "apis",
    );
    mkdirSync(appSrcDir, { recursive: true });
    mkdirSync(appSdkApisDir, { recursive: true });

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
      join(appDir, "tsconfig.app.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(appSdkApisDir, "WorkspacesApi.js"),
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
      join(
        appDir,
        "node_modules",
        "@fusebase",
        "fusebase-gate-sdk",
        "package.json",
      ),
      `{"version":"0.0.0-test-app-sdk"}`,
    );

    writeFileSync(
      join(appSrcDir, "index.ts"),
      `
      class WorkspacesApi {
        listWorkspaces() {}
      }

      const api = new WorkspacesApi();
      api.listWorkspaces();
      `,
    );

    const result = await analyzeGateSdkOperations({
      projectRoot: dir,
      scopeRoot: appDir,
    });

    expect(result.usedOps).toEqual(["listWorkspaces"]);
    expect(result.tsconfig).toBe(join(appDir, "tsconfig.app.json"));
    expect(result.sdkRoot).toBe(
      join(appDir, "node_modules", "@fusebase", "fusebase-gate-sdk"),
    );

    rmSync(dir, { recursive: true });
  });

  it("combines usedOps from app and backend tsconfigs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-backend-scope-"));
    const appDir = join(dir, "apps", "ai-membership-landing");
    const appSrcDir = join(appDir, "src");
    const backendSrcDir = join(appDir, "backend", "src");
    const sdkApisDir = join(
      dir,
      "node_modules",
      "@fusebase",
      "fusebase-gate-sdk",
      "dist",
      "apis",
    );
    mkdirSync(appSrcDir, { recursive: true });
    mkdirSync(backendSrcDir, { recursive: true });
    mkdirSync(sdkApisDir, { recursive: true });

    writeFileSync(
      join(appDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(appDir, "backend", "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
          },
          include: ["src"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(sdkApisDir, "AccessApi.js"),
      `
      class AccessApi {
        async getMyOrgAccess() {
          return this.client.request({
            method: "GET",
            path: "/:orgId/access",
            opId: "getMyOrgAccess",
          });
        }
      }
      `,
    );
    writeFileSync(
      join(sdkApisDir, "OrgUsersApi.js"),
      `
      class OrgUsersApi {
        async listOrgUsers() {
          return this.client.request({
            method: "GET",
            path: "/:orgId/users",
            opId: "listOrgUsers",
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
      join(appSrcDir, "index.ts"),
      `
      class AccessApi {
        getMyOrgAccess() {}
      }
      const accessApi = new AccessApi();
      accessApi.getMyOrgAccess();
      `,
    );

    writeFileSync(
      join(backendSrcDir, "index.ts"),
      `
      class OrgUsersApi {
        listOrgUsers() {}
      }
      const orgUsersApi = new OrgUsersApi();
      orgUsersApi.listOrgUsers();
      `,
    );

    const result = await analyzeGateSdkOperations({
      projectRoot: dir,
      scopeRoot: appDir,
    });

    expect(result.usedOps).toEqual(["getMyOrgAccess", "listOrgUsers"]);
    expect(result.tsconfig).toBe(join(appDir, "tsconfig.json"));

    rmSync(dir, { recursive: true });
  });

  it("detects trustedRuntimeContext usage in scoped backend sources", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-trusted-ctx-"));
    const appDir = join(dir, "apps", "notes");
    const backendDir = join(appDir, "backend", "src");
    mkdirSync(backendDir, { recursive: true });

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
          include: ["apps/**/*.ts"],
        },
        null,
        2,
      ),
    );

    writeFileSync(
      join(backendDir, "store.ts"),
      `
      export async function loadNotes(api: { queryIsolatedStoreSql: (body: unknown) => Promise<unknown> }, portalId: string) {
        return api.queryIsolatedStoreSql({
          trustedRuntimeContext: { portalId },
          sql: "select 1",
        });
      }
      `,
    );

    const loaded = loadTsProgram(dir);
    expect(loaded).not.toBeNull();
    expect(
      collectTrustedRuntimeContextUsage(loaded!.program, appDir),
    ).toBe(true);

    rmSync(dir, { recursive: true });
  });
});
