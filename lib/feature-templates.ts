/**
 * Feature Templates - utilities for managing and copying feature templates
 */

import { readdir, readFile, stat, mkdir, cp } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { embeddedFiles } from 'bun';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';

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
  // Check if we're in binary mode (embedded zip file)
  const zipFile = embeddedFiles.find(
    (f) => (f as any).name?.includes('feature-templates.zip')
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

  // Recursively copy template files
  await copyDirectory(templateDir, targetDir, replacements);
}

/**
 * Recursively copy directory with string replacements
 */
async function copyDirectory(
  srcDir: string,
  destDir: string,
  replacements: Record<string, string>
): Promise<void> {
  await mkdir(destDir, { recursive: true });

  const { readdir: readdirAsync, stat: statAsync } = await import('fs/promises');
  const entries = await readdirAsync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath, replacements);
    } else {
      // Read file, apply replacements, write to destination
      let content = await readFile(srcPath, 'utf-8');

      // Apply replacements
      for (const [key, value] of Object.entries(replacements)) {
        const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        content = content.replace(regex, value);
      }

      // Write file
      const { writeFile: writeFileAsync } = await import('fs/promises');
      await writeFileAsync(destPath, content, 'utf-8');
    }
  }
}
