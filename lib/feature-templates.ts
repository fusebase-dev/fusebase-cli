/**
 * Feature Templates - utilities for managing and copying feature templates
 */

import { readdir, readFile, stat, mkdir, cp } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embeddedFiles } from 'bun';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';
import { buildTemplateContext, renderTemplate } from './template-engine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  stack: string;
}

/**
 * Get feature templates directory path
 * In binary mode, extracts from embedded zip to temp directory
 * In dev mode, returns the feature-templates directory path
 */
async function getFeatureTemplatesDir(): Promise<{
  path: string;
  isBinaryMode: boolean;
  cleanup?: () => Promise<void>;
}> {
  // Check if we're in binary mode (embedded zip file).
  // Bun appends a content hash to embedded filenames (e.g. "feature-templates-c7f917bq.zip"),
  // so use includes('feature-templates') rather than includes('feature-templates.zip').
  const zipFile = embeddedFiles.find(
    (f) => (f as any).name?.includes('feature-templates')
  );

  if (zipFile) {
    // Binary mode - extract to temp directory
    const tempDir = join(tmpdir(), `fusebase-feature-templates-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const zipData = await zipFile.arrayBuffer();
    const zip = new AdmZip(Buffer.from(zipData));
    zip.extractAllTo(tempDir, true);

    return {
      path: tempDir,
      isBinaryMode: true,
      cleanup: async () => {
        try {
          const { rm } = await import('fs/promises');
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  } else {
    // Development mode - use feature-templates directory (at root level, not inside project-template)
    return {
      path: join(__dirname, '..', 'feature-templates'),
      isBinaryMode: false,
    };
  }
}

/**
 * List all available feature templates
 */
export async function listTemplates(): Promise<TemplateMetadata[]> {
  const { path: templatesDir } = await getFeatureTemplatesDir();

  try {
    const entries = await readdir(templatesDir, { withFileTypes: true });
    const templates: TemplateMetadata[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = join(templatesDir, entry.name, 'metadata.json');
        try {
          const metadataContent = await readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent) as TemplateMetadata;
          templates.push(metadata);
        } catch {
          // Skip templates without valid metadata
        }
      }
    }

    return templates;
  } catch {
    return [];
  }
}

/**
 * Copy template files to target directory
 */
export async function copyTemplate(
  templateId: string,
  targetDir: string,
  replacements: Record<string, string> = {}
): Promise<void> {
  const { path: templatesDir } = await getFeatureTemplatesDir();
  const templateDir = join(templatesDir, templateId);

  // Check if template exists
  try {
    const templateStat = await stat(templateDir);
    if (!templateStat.isDirectory()) {
      throw new Error(`Template ${templateId} is not a directory`);
    }
  } catch {
    throw new Error(`Template ${templateId} not found`);
  }

  const templateContext = buildTemplateContext();

  // Recursively copy template files (skip metadata.json at root)
  await copyDirectory(templateDir, targetDir, replacements, templateContext, true);
}

/**
 * Recursively copy directory with string replacements.
 * Skips metadata.json at the template root level.
 */
async function copyDirectory(
  srcDir: string,
  destDir: string,
  replacements: Record<string, string>,
  templateContext: Record<string, unknown>,
  isRoot = false
): Promise<void> {
  await mkdir(destDir, { recursive: true });

  const { readdir: readdirAsync } = await import('fs/promises');
  const entries = await readdirAsync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    // Skip metadata.json at template root (it's CLI config, not a template file)
    if (isRoot && entry.name === 'metadata.json') continue;

    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath, replacements, templateContext);
    } else {
      // Read file, apply replacements, write to destination
      let content = await readFile(srcPath, 'utf-8');

      // Apply replacements
      for (const [key, value] of Object.entries(replacements)) {
        const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        content = content.replace(regex, value);
      }

      // Resolve conditional template blocks (<% ... %>) against active flags
      content = renderTemplate(content, templateContext);

      // Write file
      const { writeFile: writeFileAsync } = await import('fs/promises');
      await writeFileAsync(destPath, content, 'utf-8');
    }
  }
}

/**
 * Collect files in the template that would overwrite existing files in targetDir.
 */
async function collectCollisions(
  srcDir: string,
  destDir: string,
  relativePrefix: string,
  isRoot = false
): Promise<string[]> {
  const { readdir: readdirAsync, access } = await import('fs/promises');
  let entries: import('fs').Dirent[];
  try {
    entries = await readdirAsync(srcDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const collisions: string[] = [];
  for (const entry of entries) {
    if (isRoot && entry.name === 'metadata.json') continue;

    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      const sub = await collectCollisions(srcDir + '/' + entry.name, destPath, relativePath);
      collisions.push(...sub);
    } else {
      try {
        await access(destPath);
        collisions.push(relativePath);
      } catch {
        // File doesn't exist — no collision
      }
    }
  }
  return collisions;
}

/**
 * Check whether scaffolding a template into targetDir would overwrite any existing files.
 * Returns a list of relative paths that would be overwritten (empty = safe to proceed).
 */
export async function checkTemplateCollisions(
  templateId: string,
  targetDir: string
): Promise<string[]> {
  const { path: templatesDir } = await getFeatureTemplatesDir();
  const templateDir = join(templatesDir, templateId);

  try {
    const s = await stat(templateDir);
    if (!s.isDirectory()) throw new Error();
  } catch {
    throw new Error(`Template '${templateId}' not found`);
  }

  return collectCollisions(templateDir, targetDir, '', true);
}
