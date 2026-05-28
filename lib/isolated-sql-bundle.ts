import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
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

export function buildSqlMigrationBundleArtifact(options: {
  appConfig: FeatureConfig;
  appBasePath: string;
  store: IsolatedSqlStoreConfig;
}): SqlMigrationBundleArtifact {
  const migrationsDir = join(
    options.appBasePath,
    options.store.migrationsDir ?? "postgres/migrations",
  );
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

  return {
    appId: options.appConfig.id,
    store: options.store,
    schemaName: options.store.schemaName ?? null,
    migrationsDir,
    bundle: {
      bundleVersion: manifest.bundleVersion ?? migrations.at(-1)?.version,
      migrations,
    },
    rlsManifest,
    warnings,
  };
}
