import { access, readFile } from "fs/promises";
import { basename, join, resolve } from "path";

export const DEFAULT_OPENAPI_FILENAMES = [
  "openapi.json",
  "openapi.yaml",
  "openapi.yml",
] as const;

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

const FUSEBASE_VISIBILITIES = new Set(["org", "private"]);
const FUSEBASE_EXECUTION_MODES = new Set(["sync", "async"]);

export interface OpenApiValidationIssue {
  path: string;
  message: string;
}

export interface OpenApiValidationResult {
  filePath: string;
  title: string;
  version: string;
  operationCount: number;
  operationIds: string[];
  issues: OpenApiValidationIssue[];
}

export interface PublishedAppApiManifest {
  kind: "app-api-registry";
  format: "openapi";
  schemaVersion: string;
  sourceFile: string;
  publishedAt: string;
  info: {
    title: string;
    version: string;
  };
  openapiVersion: string;
  operations: Array<{
    operationId: string;
    method: string;
    path: string;
    summary?: string;
    description?: string;
    tags?: string[];
    visibility?: string;
    executionMode?: string;
  }>;
  document: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolveOpenApiFile(
  cwd: string,
  explicitPath?: string,
): Promise<string | null> {
  if (explicitPath) {
    return resolve(cwd, explicitPath);
  }

  for (const filename of DEFAULT_OPENAPI_FILENAMES) {
    const candidate = join(cwd, filename);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function createDefaultOpenApiSpec(): string {
  return `${JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Feature Backend API",
        version: "1.0.0",
        description: "Public callable API for this Fusebase feature.",
      },
      servers: [{ url: "/api" }],
      paths: {
        "/health": {
          get: {
            operationId: "getHealth",
            summary: "Health check",
            description: "Returns the backend health status.",
            "x-fusebase-visibility": "private",
            "x-fusebase-execution-mode": "sync",
            responses: {
              "200": {
                description: "Backend is healthy",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        ok: { type: "boolean" },
                      },
                      required: ["ok"],
                      additionalProperties: false,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

export async function loadOpenApiDocument(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf-8");
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    throw new Error(
      "YAML OpenAPI specs are not supported in this Phase 1 MVP yet. Use openapi.json.",
    );
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Failed to parse OpenAPI JSON: ${message}`);
  }
}

export async function validateOpenApiFile(
  filePath: string,
): Promise<OpenApiValidationResult> {
  const document = await loadOpenApiDocument(filePath);
  return validateOpenApiDocument(document, filePath);
}

export async function loadAndValidateOpenApiFile(filePath: string): Promise<{
  document: Record<string, unknown>;
  validation: OpenApiValidationResult;
}> {
  const document = await loadOpenApiDocument(filePath);
  const validation = validateOpenApiDocument(document, filePath);
  if (!isRecord(document)) {
    throw new Error("OpenAPI document must be a JSON object.");
  }
  return { document, validation };
}

export function validateOpenApiDocument(
  document: unknown,
  filePath = "openapi.json",
): OpenApiValidationResult {
  const issues: OpenApiValidationIssue[] = [];
  const operationIds = new Set<string>();
  let operationCount = 0;
  let title = "";
  let version = "";

  const pushIssue = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isRecord(document)) {
    pushIssue("$", "OpenAPI document must be a JSON object.");
    return {
      filePath,
      title,
      version,
      operationCount,
      operationIds: [],
      issues,
    };
  }

  const openapi = document.openapi;
  if (!isNonEmptyString(openapi)) {
    pushIssue("$.openapi", "Missing OpenAPI version.");
  } else if (!(openapi === "3.1.0" || openapi.startsWith("3.1."))) {
    pushIssue(
      "$.openapi",
      `OpenAPI version must be 3.1.x. Received: ${openapi}`,
    );
  }

  const info = document.info;
  if (!isRecord(info)) {
    pushIssue("$.info", "Missing info object.");
  } else {
    if (!isNonEmptyString(info.title)) {
      pushIssue("$.info.title", "info.title must be a non-empty string.");
    } else {
      title = info.title.trim();
    }
    if (!isNonEmptyString(info.version)) {
      pushIssue("$.info.version", "info.version must be a non-empty string.");
    } else {
      version = info.version.trim();
    }
  }

  const paths = document.paths;
  if (!isRecord(paths)) {
    pushIssue("$.paths", "paths must be an object.");
  } else {
    for (const [pathKey, pathValue] of Object.entries(paths)) {
      const pathPrefix = `$.paths.${JSON.stringify(pathKey)}`;
      if (!pathKey.startsWith("/")) {
        pushIssue(pathPrefix, "Path keys must start with '/'.");
      }
      if (!isRecord(pathValue)) {
        pushIssue(pathPrefix, "Path item must be an object.");
        continue;
      }

      for (const [method, operation] of Object.entries(pathValue)) {
        if (!HTTP_METHODS.has(method)) {
          continue;
        }
        operationCount += 1;
        const operationPrefix = `${pathPrefix}.${method}`;
        if (!isRecord(operation)) {
          pushIssue(operationPrefix, "Operation must be an object.");
          continue;
        }

        const operationId = operation.operationId;
        if (!isNonEmptyString(operationId)) {
          pushIssue(
            `${operationPrefix}.operationId`,
            "operationId must be a non-empty string.",
          );
        } else if (operationIds.has(operationId)) {
          pushIssue(
            `${operationPrefix}.operationId`,
            `Duplicate operationId: ${operationId}`,
          );
        } else {
          operationIds.add(operationId);
        }

        const visibility = operation["x-fusebase-visibility"];
        if (
          visibility !== undefined &&
          (!isNonEmptyString(visibility) ||
            !FUSEBASE_VISIBILITIES.has(visibility))
        ) {
          pushIssue(
            `${operationPrefix}.x-fusebase-visibility`,
            "x-fusebase-visibility must be 'org' or 'private'.",
          );
        }

        const executionMode = operation["x-fusebase-execution-mode"];
        if (
          executionMode !== undefined &&
          (!isNonEmptyString(executionMode) ||
            !FUSEBASE_EXECUTION_MODES.has(executionMode))
        ) {
          pushIssue(
            `${operationPrefix}.x-fusebase-execution-mode`,
            "x-fusebase-execution-mode must be 'sync' or 'async'.",
          );
        }

        const auth = operation["x-fusebase-auth"];
        if (auth !== undefined) {
          if (!isRecord(auth)) {
            pushIssue(
              `${operationPrefix}.x-fusebase-auth`,
              "x-fusebase-auth must be an object.",
            );
          } else {
            const requiresUserContext = auth.requiresUserContext;
            if (
              requiresUserContext !== undefined &&
              typeof requiresUserContext !== "boolean"
            ) {
              pushIssue(
                `${operationPrefix}.x-fusebase-auth.requiresUserContext`,
                "requiresUserContext must be a boolean.",
              );
            }

            const allowedCallerTypes = auth.allowedCallerTypes;
            if (
              allowedCallerTypes !== undefined &&
              (!Array.isArray(allowedCallerTypes) ||
                allowedCallerTypes.some((item) => !isNonEmptyString(item)))
            ) {
              pushIssue(
                `${operationPrefix}.x-fusebase-auth.allowedCallerTypes`,
                "allowedCallerTypes must be an array of non-empty strings.",
              );
            }
          }
        }

        const responses = operation.responses;
        if (!isRecord(responses) || Object.keys(responses).length === 0) {
          pushIssue(
            `${operationPrefix}.responses`,
            "Operation must declare at least one response.",
          );
        }
      }
    }
  }

  if (operationCount === 0) {
    pushIssue("$.paths", "OpenAPI spec must declare at least one operation.");
  }

  return {
    filePath,
    title,
    version,
    operationCount,
    operationIds: [...operationIds].sort((a, b) => a.localeCompare(b)),
    issues,
  };
}

export function buildPublishedAppApiManifest(params: {
  filePath: string;
  document: Record<string, unknown>;
  validation: OpenApiValidationResult;
  publishedAt?: string;
}): PublishedAppApiManifest {
  const { filePath, document, validation } = params;
  const paths = isRecord(document.paths) ? document.paths : {};
  const operations: PublishedAppApiManifest["operations"] = [];

  for (const [pathKey, pathValue] of Object.entries(paths)) {
    if (!isRecord(pathValue)) continue;
    for (const [method, operation] of Object.entries(pathValue)) {
      if (!HTTP_METHODS.has(method) || !isRecord(operation)) continue;
      const operationId = operation.operationId;
      if (!isNonEmptyString(operationId)) continue;
      operations.push({
        operationId,
        method,
        path: pathKey,
        summary: isNonEmptyString(operation.summary)
          ? operation.summary.trim()
          : undefined,
        description: isNonEmptyString(operation.description)
          ? operation.description.trim()
          : undefined,
        tags: Array.isArray(operation.tags)
          ? operation.tags.filter(isNonEmptyString).map((tag) => tag.trim())
          : undefined,
        visibility: isNonEmptyString(operation["x-fusebase-visibility"])
          ? operation["x-fusebase-visibility"].trim()
          : undefined,
        executionMode: isNonEmptyString(operation["x-fusebase-execution-mode"])
          ? operation["x-fusebase-execution-mode"].trim()
          : undefined,
      });
    }
  }

  return {
    kind: "app-api-registry",
    format: "openapi",
    schemaVersion: "2026-04-29",
    sourceFile: basename(filePath),
    publishedAt: params.publishedAt ?? new Date().toISOString(),
    info: {
      title: validation.title,
      version: validation.version,
    },
    openapiVersion:
      typeof document.openapi === "string" ? document.openapi : "3.1.0",
    operations: operations.sort((a, b) =>
      a.operationId.localeCompare(b.operationId),
    ),
    document,
  };
}
