import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveMigrationsDir } from "../lib/isolated-sql-bundle.ts";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): { cwd: string; appBasePath: string } {
  const cwd = mkdtempSync(join(tmpdir(), "mig-dir-"));
  tempDirs.push(cwd);
  const appBasePath = join(cwd, "apps/probe");
  mkdirSync(appBasePath, { recursive: true });
  return { cwd, appBasePath };
}

function makeMigrations(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ migrations: [] }));
  return dir;
}

describe("resolveMigrationsDir", () => {
  it("defaults to postgres/migrations inside the app folder", () => {
    const { cwd, appBasePath } = makeRepo();
    expect(resolveMigrationsDir({ cwd, appBasePath })).toBe(
      join(appBasePath, "postgres/migrations"),
    );
  });

  it("resolves a declared dir relative to the APP folder (historical meaning)", () => {
    // Regression guard: projects and the docs example declare
    // "postgres/migrations" meaning app-relative. Resolving that from the repo
    // root instead silently breaks every one of them.
    const { cwd, appBasePath } = makeRepo();
    const expected = makeMigrations(join(appBasePath, "postgres/migrations"));

    expect(
      resolveMigrationsDir({ cwd, appBasePath, migrationsDir: "postgres/migrations" }),
    ).toBe(expected);
  });

  it("falls back to a repo-level folder when the app has none", () => {
    const { cwd, appBasePath } = makeRepo();
    const expected = makeMigrations(join(cwd, "shared/postgres/migrations"));

    expect(
      resolveMigrationsDir({
        cwd,
        appBasePath,
        migrationsDir: "shared/postgres/migrations",
      }),
    ).toBe(expected);
  });

  it("prefers the app folder when both locations exist", () => {
    const { cwd, appBasePath } = makeRepo();
    const appLevel = makeMigrations(join(appBasePath, "postgres/migrations"));
    makeMigrations(join(cwd, "postgres/migrations"));

    expect(
      resolveMigrationsDir({ cwd, appBasePath, migrationsDir: "postgres/migrations" }),
    ).toBe(appLevel);
  });

  it("uses an absolute path as given", () => {
    const { cwd, appBasePath } = makeRepo();
    const absolute = makeMigrations(join(cwd, "elsewhere/migrations"));

    expect(
      resolveMigrationsDir({ cwd, appBasePath, migrationsDir: absolute }),
    ).toBe(absolute);
  });

  it("names both candidate paths when neither has a manifest", () => {
    const { cwd, appBasePath } = makeRepo();

    expect(() =>
      resolveMigrationsDir({ cwd, appBasePath, migrationsDir: "postgres/migrations" }),
    ).toThrow(/app-relative[\s\S]*repo-relative/);
  });

  it("treats a blank declared dir as unset", () => {
    const { cwd, appBasePath } = makeRepo();
    expect(resolveMigrationsDir({ cwd, appBasePath, migrationsDir: "  " })).toBe(
      join(appBasePath, "postgres/migrations"),
    );
  });
});
