import { appendFile, mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { logger } from "../logger";

const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 20;
const MAX_DEPTH = 4;
const MAX_BODY_BYTES = 24_000;
const MAX_HEADER_VALUE_LENGTH = 1_000;
const MIN_REGISTERED_SENSITIVE_VALUE_LENGTH = 3;

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

interface HeaderLookup {
  get(name: string): string | null;
}

export interface DevSessionLogPaths {
  sessionDir: string;
  browserDebugPath: string;
  accessLogsPath: string;
  backendOutputPath: string;
  frontendDevServerPath: string;
}

export interface JsonlAppender {
  append: (record: Record<string, unknown>) => void;
  flush: () => Promise<void>;
}

const jsonlWriteQueues = new Map<string, Promise<void>>();
const registeredSensitiveValues = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return (
    lowerKey.includes("token") ||
    lowerKey.includes("secret") ||
    lowerKey.includes("authorization") ||
    lowerKey.includes("cookie")
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRegisteredSensitiveValues(): string[] {
  return [...registeredSensitiveValues].sort((left, right) => right.length - left.length);
}

export function registerSensitiveValues(values: Iterable<string>): void {
  for (const value of values) {
    const normalizedValue = value.trim();
    if (normalizedValue.length < MIN_REGISTERED_SENSITIVE_VALUE_LENGTH) {
      continue;
    }

    registeredSensitiveValues.add(normalizedValue);
  }
}

export function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID()}`;
  }

  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createDevSessionLogPaths(
  logsRootDir: string,
): Promise<DevSessionLogPaths> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sessionDir = join(logsRootDir, "logs", `dev-${timestamp}`);

  await mkdir(sessionDir, { recursive: true });

  const logPaths = {
    sessionDir,
    browserDebugPath: join(sessionDir, "browser-logs.jsonl"),
    accessLogsPath: join(sessionDir, "access-logs.jsonl"),
    backendOutputPath: join(sessionDir, "backend-logs.jsonl"),
    frontendDevServerPath: join(sessionDir, "frontend-dev-server-logs.jsonl"),
  };

  await Promise.all([
    writeFile(logPaths.browserDebugPath, "", { flag: "a" }),
    writeFile(logPaths.accessLogsPath, "", { flag: "a" }),
    writeFile(logPaths.backendOutputPath, "", { flag: "a" }),
    writeFile(logPaths.frontendDevServerPath, "", { flag: "a" }),
  ]);

  return logPaths;
}

export function redactSensitiveText(value: string): string {
  let redactedValue = value
    .replace(/(bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(
      /((?:token|secret|authorization|cookie)[^:=\n]{0,20}[:=]\s*)([^\s,;]+)/gi,
      "$1[REDACTED]",
    )
    .replace(
      /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+/g,
      "[REDACTED_JWT]",
    );

  for (const sensitiveValue of getRegisteredSensitiveValues()) {
    redactedValue = redactedValue.replace(
      new RegExp(escapeRegExp(sensitiveValue), "g"),
      "[REDACTED]",
    );
  }

  return redactedValue;
}

export function truncateString(
  value: string,
  maxLength: number = MAX_STRING_LENGTH,
): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength)}...[truncated]`;
}

export function sanitizeOptionalString(
  value: unknown,
  maxLength?: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return truncateString(redactSensitiveText(value), maxLength);
}

export function sanitizeJsonValue(value: unknown, depth: number = 0): JsonValue {
  if (value === null) {
    return null;
  }

  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }

  if (typeof value === "string") {
    return truncateString(redactSensitiveText(value));
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return truncateString(value.toString());
  }

  if (typeof value === "undefined") {
    return "[undefined]";
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return truncateString(String(value));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(redactSensitiveText(value.message || "")),
      stack:
        typeof value.stack === "string"
          ? truncateString(redactSensitiveText(value.stack), 6_000)
          : null,
    };
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeJsonValue(entry, depth + 1));
  }

  if (!isRecord(value)) {
    return truncateString(redactSensitiveText(String(value)));
  }

  const ctorName = value.constructor?.name;
  if (ctorName && ctorName !== "Object") {
    return `[${ctorName}]`;
  }

  const output: Record<string, JsonValue> = {};
  for (const [key, entryValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (isSensitiveKey(key)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = sanitizeJsonValue(entryValue, depth + 1);
  }

  if (Object.keys(value).length > MAX_OBJECT_KEYS) {
    output.__truncated__ = true;
  }

  return output;
}

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lowerKey) || isSensitiveKey(lowerKey)) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = truncateString(
      redactSensitiveText(value),
      MAX_HEADER_VALUE_LENGTH,
    );
  }

  return output;
}

function sanitizeBodyText(rawBody: string): JsonValue | string {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return sanitizeJsonValue(parsed);
  } catch {
    return truncateString(redactSensitiveText(trimmed));
  }
}

function shouldCaptureBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function shouldCaptureResponseBody(method: string): boolean {
  return method !== "HEAD";
}

function isSupportedBodyContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized === "" ||
    normalized.includes("application/json") ||
    normalized.includes("+json") ||
    normalized.startsWith("text/")
  );
}

function getBodySkipReason(headers: HeaderLookup): string | null {
  const contentType = headers.get("content-type") || "";
  if (!isSupportedBodyContentType(contentType)) {
    return "[omitted: unsupported content-type]";
  }

  return null;
}

function isBodyTooLarge(text: string): boolean {
  return new TextEncoder().encode(text).length > MAX_BODY_BYTES;
}

/**
 * Reads and sanitizes a request body for access logging.
 * @param req Original incoming request. The body is read from a clone.
 */
export async function summarizeRequestBody(
  req: Request,
): Promise<JsonValue | string | null> {
  if (!shouldCaptureBody(req.method)) {
    return null;
  }

  const skipReason = getBodySkipReason(req.headers);
  if (skipReason) {
    return skipReason;
  }

  const text = await req.clone().text();
  if (isBodyTooLarge(text)) {
    return "[omitted: body too large]";
  }

  return sanitizeBodyText(text);
}

/**
 * Reads and sanitizes a proxied response body for access logging.
 * @param response Proxy response wrapper. The body is read from a clone.
 * @param method Original request method, used to skip bodies like HEAD.
 */
export async function summarizeResponseBody(
  response: { headers: HeaderLookup; clone: () => { text: () => Promise<string> } },
  method: string,
): Promise<JsonValue | string | null> {
  if (!shouldCaptureResponseBody(method)) {
    return null;
  }

  const skipReason = getBodySkipReason(response.headers);
  if (skipReason) {
    return skipReason;
  }

  const text = await response.clone().text();
  if (isBodyTooLarge(text)) {
    return "[omitted: body too large]";
  }

  return sanitizeBodyText(text);
}

async function appendJsonlLines(
  filePath: string,
  context: string,
  lines: string,
): Promise<void> {
  const queuedWrite = (jsonlWriteQueues.get(filePath) ?? Promise.resolve())
    .then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, lines, "utf8");
    })
    .catch((error: unknown) => {
      logger.error({ error, context, filePath }, "Failed to append JSONL record");
    });

  jsonlWriteQueues.set(filePath, queuedWrite);
  await queuedWrite;
}

export async function appendJsonlRecords<T extends object>(
  filePath: string,
  context: string,
  records: T[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const lines = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  await appendJsonlLines(filePath, context, lines);
}

export function createJsonlAppender(
  filePath: string,
  context: string,
): JsonlAppender {
  let writeQueue = Promise.resolve();

  return {
    append(record: Record<string, unknown>) {
      writeQueue = writeQueue
        .then(() => appendJsonlRecords(filePath, context, [record]));
    },
    async flush() {
      await writeQueue;
    },
  };
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
