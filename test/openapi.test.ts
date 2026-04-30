import { describe, expect, it } from "bun:test";
import {
  buildPublishedAppApiManifest,
  createDefaultOpenApiSpec,
  validateOpenApiDocument,
} from "../lib/openapi";

describe("OpenAPI Phase 1 validator", () => {
  it("accepts the default scaffolded OpenAPI spec", () => {
    const document = JSON.parse(createDefaultOpenApiSpec()) as unknown;
    const result = validateOpenApiDocument(document);

    expect(result.issues).toEqual([]);
    expect(result.operationCount).toBe(1);
    expect(result.operationIds).toEqual(["getHealth"]);
    expect(result.title).toBe("Feature Backend API");
    expect(result.version).toBe("1.0.0");
  });

  it("rejects unsupported OpenAPI versions and duplicate operation ids", () => {
    const result = validateOpenApiDocument({
      openapi: "3.0.3",
      info: {
        title: "Broken API",
        version: "1.0.0",
      },
      paths: {
        "/a": {
          get: {
            operationId: "duplicateOp",
            responses: {
              "200": {
                description: "ok",
              },
            },
          },
        },
        "/b": {
          post: {
            operationId: "duplicateOp",
            "x-fusebase-execution-mode": "later",
            responses: {
              "200": {
                description: "ok",
              },
            },
          },
        },
      },
    });

    expect(result.issues.map((issue) => issue.message)).toContain(
      "OpenAPI version must be 3.1.x. Received: 3.0.3",
    );
    expect(result.issues.map((issue) => issue.message)).toContain(
      "Duplicate operationId: duplicateOp",
    );
    expect(result.issues.map((issue) => issue.message)).toContain(
      "x-fusebase-execution-mode must be 'sync' or 'async'.",
    );
  });

  it("builds a published app API manifest from a valid spec", () => {
    const document = JSON.parse(createDefaultOpenApiSpec()) as Record<
      string,
      unknown
    >;
    const validation = validateOpenApiDocument(document, "/tmp/openapi.json");
    const manifest = buildPublishedAppApiManifest({
      filePath: "/tmp/openapi.json",
      document,
      validation,
      publishedAt: "2026-04-29T12:00:00.000Z",
    });

    expect(manifest.kind).toBe("app-api-registry");
    expect(manifest.format).toBe("openapi");
    expect(manifest.sourceFile).toBe("openapi.json");
    expect(manifest.info.title).toBe("Feature Backend API");
    expect(manifest.operations).toEqual([
      {
        operationId: "getHealth",
        method: "get",
        path: "/health",
        summary: "Health check",
        description: "Returns the backend health status.",
        tags: undefined,
        visibility: "private",
        executionMode: "sync",
      },
    ]);
  });
});
