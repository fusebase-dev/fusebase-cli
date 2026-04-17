import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import type { FuseConfig } from "../../config";
import {
  getManagedDependencyNames,
  loadProjectTemplatePackageJson,
  type ProjectTemplatePackageJson,
} from "../../project-template-manifest";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ManagedDepsSyncResult {
  /** Absolute-ish paths relative to cwd that had package.json changed */
  changedPackageRoots: string[];
}

function mergeManagedDepsIntoPackageJson(
  pkg: Record<string, unknown>,
  template: ProjectTemplatePackageJson,
  managedNames: string[],
  mode: "root" | "feature",
): boolean {
  const templateDeps = template.dependencies ?? {};
  let changed = false;

  if (!pkg.dependencies || typeof pkg.dependencies !== "object" || Array.isArray(pkg.dependencies)) {
    if (mode === "root") {
      pkg.dependencies = {};
    } else {
      return false;
    }
  }

  const deps = pkg.dependencies as Record<string, string>;

  for (const name of managedNames) {
    const spec = templateDeps[name];
    if (typeof spec !== "string" || !spec.trim()) {
      continue;
    }
    const next = spec.trim();
    if (mode === "feature" && deps[name] === undefined) {
      continue;
    }
    if (deps[name] === undefined) {
      deps[name] = next;
      changed = true;
    } else if (deps[name] !== next) {
      deps[name] = next;
      changed = true;
    }
  }

  return changed;
}

/**
 * Sync managed dependency versions from project-template into root and feature package.json files.
 * Feature manifests: only bump versions for deps that already exist (no new keys).
 */
export async function syncManagedDependencies(options: {
  cwd: string;
  fuseConfig: FuseConfig;
  dryRun: boolean;
}): Promise<ManagedDepsSyncResult> {
  const { cwd, fuseConfig, dryRun } = options;
  const template = await loadProjectTemplatePackageJson();
  const managedNames = getManagedDependencyNames(template);
  const changedPackageRoots: string[] = [];

  const targets: { rel: string; mode: "root" | "feature" }[] = [];
  if (await fileExists(join(cwd, "package.json"))) {
    targets.push({ rel: "package.json", mode: "root" });
  }
  const features = fuseConfig.features ?? [];
  for (const f of features) {
    const p = f.path?.trim();
    if (!p) continue;
    const rel = join(p, "package.json");
    if (await fileExists(join(cwd, rel))) {
      targets.push({ rel, mode: "feature" });
    }
  }

  for (const { rel, mode } of targets) {
    const full = join(cwd, rel);
    const raw = await readFile(full, "utf-8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn(`⚠ Skipping invalid JSON: ${rel}`);
      continue;
    }
    const before = JSON.stringify(parsed);
    const changed = mergeManagedDepsIntoPackageJson(parsed, template, managedNames, mode);
    if (!changed) continue;
    const after = JSON.stringify(parsed);
    if (before === after) continue;

    if (dryRun) {
      console.log(`[dry-run] Would update managed deps in ${rel}`);
      changedPackageRoots.push(mode === "root" ? "." : dirnameRel(rel));
      continue;
    }

    await writeFile(full, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
    console.log(`✓ Updated managed dependencies in ${rel}`);
    changedPackageRoots.push(mode === "root" ? "." : dirnameRel(rel));
  }

  return { changedPackageRoots };
}

function dirnameRel(packageJsonRel: string): string {
  const parts = packageJsonRel.split(/[/\\]/);
  parts.pop();
  const dir = parts.join("/");
  return dir.length > 0 ? dir : ".";
}
