import { readFile, access } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { embeddedFiles } from "bun";
import AdmZip from "adm-zip";

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_MANAGED = [
  "@fusebase/dashboard-service-sdk",
  "@fusebase/fusebase-gate-sdk",
] as const;

export interface ProjectTemplatePackageJson {
  dependencies?: Record<string, string>;
  fusebaseCli?: { managedDependencies?: string[] };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load `project-template/package.json` from disk (dev) or embedded zip (binary).
 */
export async function loadProjectTemplatePackageJson(): Promise<ProjectTemplatePackageJson> {
  const zipFile = embeddedFiles.find(
    (f) =>
      (f as { name?: string }).name?.includes("project-template") &&
      (f as { name?: string }).name?.endsWith(".zip"),
  );

  if (zipFile) {
    const zipData = await (zipFile as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer();
    const zip = new AdmZip(Buffer.from(zipData));
    const entry = zip.getEntry("package.json");
    if (!entry || entry.isDirectory) {
      throw new Error("Embedded project-template.zip missing package.json");
    }
    const raw = entry.getData().toString("utf-8");
    return JSON.parse(raw) as ProjectTemplatePackageJson;
  }

  const path = join(__dirname, "..", "project-template", "package.json");
  if (!(await fileExists(path))) {
    throw new Error(`project-template/package.json not found at ${path}`);
  }
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as ProjectTemplatePackageJson;
}

export function getManagedDependencyNames(template: ProjectTemplatePackageJson): string[] {
  const fromMeta = template.fusebaseCli?.managedDependencies;
  if (Array.isArray(fromMeta) && fromMeta.length > 0) {
    return fromMeta.filter((s) => typeof s === "string" && s.trim().length > 0);
  }
  return [...DEFAULT_MANAGED];
}

export function getGateSdkVersionSpec(template: ProjectTemplatePackageJson): string | undefined {
  const v = template.dependencies?.["@fusebase/fusebase-gate-sdk"];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
