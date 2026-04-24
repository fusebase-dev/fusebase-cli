import { Eta } from "eta";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, extname, basename } from "path";
import { getFlags } from "./config";

/** File extensions that should be processed through templating. */
const TEMPLATE_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".jsonc",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".cts",
  ".mts",
  ".html",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".conf",
  ".xml",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
]);

/** Extensionless/text config files that should be processed through templating. */
const TEMPLATE_BASENAMES = new Set([
  ".env",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  ".dockerignore",
  ".eslintignore",
  ".prettierignore",
  ".editorconfig",
  "Dockerfile",
  "Makefile",
  "docker-compose.yml",
  "docker-compose.yaml",
]);

function shouldTemplate(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  if (TEMPLATE_EXTENSIONS.has(ext)) {
    return true;
  }

  const name = basename(filePath);
  return TEMPLATE_BASENAMES.has(name);
}

const eta = new Eta({ autoEscape: false });

/** Build the template context from current flags. */
export function buildTemplateContext(): Record<string, unknown> {
  const flags = getFlags();
  const context: Record<string, unknown> = {
    flags,
  };
  // Each known flag becomes a boolean in the context
  for (const flag of flags) {
    context[flag] = true;
  }
  return context;
}

/**
 * Render a single file's content through Eta if it contains template markers.
 * Returns the rendered content.
 */
export function renderTemplate(content: string, context: Record<string, unknown>): string {
  // Skip files that don't contain any Eta template tags
  if (!content.includes("<%")) {
    return content;
  }

  return eta.renderString(content, context);
}

/**
 * Process a directory tree: render all template-eligible files in-place.
 */
export function renderTemplatesInDir(dir: string, context: Record<string, unknown>): void {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      renderTemplatesInDir(fullPath, context);
    } else if (entry.isFile() && shouldTemplate(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      const rendered = renderTemplate(content, context);
      if (rendered !== content) {
        writeFileSync(fullPath, rendered, "utf-8");
      }
    }
  }
}

/**
 * Render a single file in-place through Eta.
 */
export function renderTemplateFile(filePath: string, context: Record<string, unknown>): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  const rendered = renderTemplate(content, context);
  if (rendered !== content) {
    writeFileSync(filePath, rendered, "utf-8");
  }
}
