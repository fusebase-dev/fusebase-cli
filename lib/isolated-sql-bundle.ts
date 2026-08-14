import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";
import { requireAppId } from "./config";
import type {
  FeatureConfig,
  IsolatedSqlRlsManifest,
  IsolatedSqlStoreConfig,
} from "./config";

export interface SqlMigrationBundleEntry {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export interface SqlMigrationBundle {
  bundleVersion?: string | number;
  migrations: SqlMigrationBundleEntry[];
}

export interface SqlMigrationBundleArtifact {
  appId: string;
  store: IsolatedSqlStoreConfig;
  schemaName: string | null;
  migrationsDir: string;
  bundle: SqlMigrationBundle;
  rlsManifest: IsolatedSqlRlsManifest | null;
  warnings: string[];
}

interface MigrationManifestEntry {
  version: number | string;
  name?: string;
  file: string;
  checksum?: string;
}

interface MigrationManifest {
  bundleVersion?: string | number;
  migrations: MigrationManifestEntry[];
  rlsManifest?: IsolatedSqlRlsManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function parseMigrationManifest(path: string): MigrationManifest {
  const raw = readJsonFile(path);
  if (!isRecord(raw) || !Array.isArray(raw["migrations"])) {
    throw new Error(`Invalid SQL migration manifest: ${path}`);
  }
  const migrations = raw["migrations"].map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid migration entry at index ${index} in ${path}`);
    }
    const version = entry["version"];
    const file = entry["file"];
    if (
      (typeof version !== "number" && typeof version !== "string") ||
      typeof file !== "string" ||
      file.trim().length === 0
    ) {
      throw new Error(
        `Migration entry ${index} in ${path} must include version and file`,
      );
    }
    const name = entry["name"];
    const checksum = entry["checksum"];
    return {
      version,
      file,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof checksum === "string" ? { checksum } : {}),
    };
  });
  const bundleVersion = raw["bundleVersion"];
  const rlsManifest = raw["rlsManifest"];
  return {
    ...(typeof bundleVersion === "number" || typeof bundleVersion === "string"
      ? { bundleVersion }
      : {}),
    migrations,
    ...(isRlsManifest(rlsManifest) ? { rlsManifest } : {}),
  };
}

export function canonicalizeSqlForGate(sql: string): string {
  return sql.replace(/\r\n?/g, "\n").trimEnd();
}

export function calculateSqlMigrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(canonicalizeSqlForGate(sql), "utf-8")
    .digest("hex");
}

function parseVersion(value: number | string, file: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  const raw = String(value).trim();
  const digits = raw.match(/\d+/)?.[0];
  const parsed = digits === undefined ? Number.NaN : Number.parseInt(digits, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid migration version "${raw}" for ${file}`);
  }
  return parsed;
}

function nameFromFile(file: string): string {
  const base = file.replace(/\.sql$/i, "");
  const flyway = base.match(/^V?\d+__(.+)$/i);
  if (flyway !== null) {
    return flyway[1]!.replace(/[^A-Za-z0-9_]+/g, "_");
  }
  const prefixed = base.match(/^\d+[_-](.+)$/);
  if (prefixed !== null) {
    return prefixed[1]!.replace(/[^A-Za-z0-9_]+/g, "_");
  }
  return base.replace(/[^A-Za-z0-9_]+/g, "_");
}

export function isRlsManifest(
  value: unknown,
): value is IsolatedSqlRlsManifest {
  if (!isRecord(value) || !isRecord(value["tables"])) {
    return false;
  }
  return Object.values(value["tables"]).every((table) => {
    return isRecord(table) && typeof table["classification"] === "string";
  });
}

function readRlsManifest(
  appBasePath: string,
  migrationsDir: string,
  store: IsolatedSqlStoreConfig,
  manifest: MigrationManifest,
): IsolatedSqlRlsManifest | null {
  if (isRlsManifest(store.rlsManifest)) {
    return store.rlsManifest;
  }
  if (store.rlsManifestFile !== undefined) {
    const path = join(appBasePath, store.rlsManifestFile);
    const raw = readJsonFile(path);
    if (!isRlsManifest(raw)) {
      throw new Error(`Invalid RLS manifest: ${path}`);
    }
    return raw;
  }
  if (isRlsManifest(manifest.rlsManifest)) {
    return manifest.rlsManifest;
  }
  const defaultPath = join(migrationsDir, "rls-manifest.json");
  if (existsSync(defaultPath)) {
    const raw = readJsonFile(defaultPath);
    if (!isRlsManifest(raw)) {
      throw new Error(`Invalid RLS manifest: ${defaultPath}`);
    }
    return raw;
  }
  return null;
}

export function resolveSqlStoreConfig(
  appConfig: FeatureConfig,
  alias?: string,
): IsolatedSqlStoreConfig | null {
  const stores = appConfig.isolatedStores?.sql ?? [];
  if (stores.length === 0) {
    return null;
  }
  if (alias === undefined) {
    if (stores.length > 1) {
      throw new Error(
        `App ${appConfig.id} has multiple SQL isolated stores; pass --alias`,
      );
    }
    return stores[0] ?? null;
  }
  const found = stores.find((store) => store.alias === alias);
  if (found === undefined) {
    throw new Error(`SQL isolated store alias "${alias}" not found`);
  }
  return found;
}

const DEFAULT_MIGRATIONS_DIR = "postgres/migrations";

/**
 * Locate an app's migrations folder.
 *
 * A declared `migrationsDir` has always meant "relative to the app folder"
 * (`apps/<app>/postgres/migrations`), and that is what existing projects and
 * the docs example already carry — so it is tried FIRST and still wins.
 * Repo-relative resolution is the newer capability (a shared, repo-level
 * migrations folder such as "shared/postgres/migrations") and is the fallback.
 * An absolute path is used as given.
 *
 * The probe is `manifest.json`, because that is the file the caller needs next:
 * a folder without a manifest is not a migrations folder.
 */
export function resolveMigrationsDir(options: {
  appBasePath: string;
  cwd: string;
  migrationsDir?: string;
}): string {
  const declared = options.migrationsDir;
  if (declared === undefined || declared.trim().length === 0) {
    return join(options.appBasePath, DEFAULT_MIGRATIONS_DIR);
  }
  if (isAbsolute(declared)) {
    return declared;
  }

  const appRelative = join(options.appBasePath, declared);
  if (existsSync(join(appRelative, "manifest.json"))) {
    return appRelative;
  }
  const repoRelative = join(options.cwd, declared);
  if (existsSync(join(repoRelative, "manifest.json"))) {
    return repoRelative;
  }

  // Neither location has a manifest — name both so the fix is obvious instead
  // of surfacing a bare ENOENT for whichever path happened to be tried last.
  throw new Error(
    `No manifest.json found for isolated store migrations "${declared}". Looked in:\n` +
      `  ${join(appRelative, "manifest.json")} (app-relative)\n` +
      `  ${join(repoRelative, "manifest.json")} (repo-relative)`,
  );
}

export function buildSqlMigrationBundleArtifact(options: {
  appConfig: FeatureConfig;
  appBasePath: string;
  /**
   * Repo root (cwd of the fusebase process). Used as the fallback base for an
   * explicitly-declared `store.migrationsDir` so a shared/repo-level migrations
   * folder works — see `resolveMigrationsDir`.
   */
  cwd: string;
  store: IsolatedSqlStoreConfig;
}): SqlMigrationBundleArtifact {
  const migrationsDir = resolveMigrationsDir({
    appBasePath: options.appBasePath,
    cwd: options.cwd,
    migrationsDir: options.store.migrationsDir,
  });
  const manifestPath = join(migrationsDir, "manifest.json");
  const manifest = parseMigrationManifest(manifestPath);
  const warnings: string[] = [];

  const migrations = manifest.migrations.map((entry) => {
    const filePath = join(migrationsDir, entry.file);
    const sql = readFileSync(filePath, "utf-8");
    const checksum = calculateSqlMigrationChecksum(sql);
    if (entry.checksum !== undefined && entry.checksum !== checksum) {
      warnings.push(
        `${entry.file}: manifest checksum ${entry.checksum} differs from canonical checksum ${checksum}`,
      );
    }
    return {
      version: parseVersion(entry.version, entry.file),
      name: entry.name ?? nameFromFile(entry.file),
      checksum,
      sql,
    };
  });

  migrations.sort((a, b) => a.version - b.version);
  for (let i = 1; i < migrations.length; i += 1) {
    const prev = migrations[i - 1]!;
    const current = migrations[i]!;
    if (current.version <= prev.version) {
      throw new Error(
        `Migration versions must be strictly increasing; saw ${prev.version} then ${current.version}`,
      );
    }
  }

  const rlsManifest = readRlsManifest(
    options.appBasePath,
    migrationsDir,
    options.store,
    manifest,
  );

  const rawBundleVersion = manifest.bundleVersion ?? migrations.at(-1)?.version;

  return {
    appId: requireAppId(options.appConfig),
    store: options.store,
    schemaName: options.store.schemaName ?? null,
    migrationsDir,
    bundle: {
      bundleVersion:
        rawBundleVersion === undefined || rawBundleVersion === null
          ? undefined
          : String(rawBundleVersion),
      migrations,
    },
    rlsManifest,
    warnings,
  };
}
