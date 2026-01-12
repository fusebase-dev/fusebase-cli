import {
  appendJsonlRecords,
  sanitizeJsonValue,
  sanitizeOptionalString,
  truncateString,
  type JsonValue,
} from "./dev-debug-logs";
import { BROWSER_DEBUG_SCRIPT_TEMPLATE } from "./browser-debug-script";
import { logger } from "../logger";

const MAX_ARRAY_LENGTH = 20;
const MAX_EVENT_BYTES = 24_000;

export const DEBUG_SCRIPT_PATH = "/__fusebase/debug.js";
export const DEBUG_LOG_PATH = "/__debug";

interface BrowserDebugEventInput {
  sessionId?: unknown;
  sequence?: unknown;
  timestamp?: unknown;
  type?: unknown;
  level?: unknown;
  url?: unknown;
  pathname?: unknown;
  message?: unknown;
  args?: unknown;
  error?: unknown;
  userAgent?: unknown;
}

interface BrowserDebugLogRecord {
  timestamp: string;
  sessionId: string | null;
  sequence: number | null;
  type: string;
  level: string;
  url: string | null;
  pathname: string | null;
  featureId: string | null;
  userAgent: string | null;
  message: string | null;
  args?: JsonValue[];
  error?: JsonValue;
}

const BROWSER_DEBUG_SCRIPT = BROWSER_DEBUG_SCRIPT_TEMPLATE.replace(
  "__DEBUG_LOG_PATH__",
  DEBUG_LOG_PATH,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMessageFromArgs(args: JsonValue[]): string | null {
  if (args.length === 0) {
    return null;
  }

  const message = args
    .map((arg) =>
      typeof arg === "string" ? arg : truncateString(JSON.stringify(arg)),
    )
    .join(" ");

  return truncateString(message);
}

function getEventInputs(payload: unknown): BrowserDebugEventInput[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (isRecord(payload) && Array.isArray(payload.events)) {
    return payload.events.filter(isRecord);
  }

  if (isRecord(payload)) {
    return [payload];
  }

  return [];
}

function normalizeEvent(
  payload: BrowserDebugEventInput,
  featureId: string | undefined,
  requestUserAgent: string | null,
): BrowserDebugLogRecord {
  const args = Array.isArray(payload.args)
    ? payload.args
        .slice(0, MAX_ARRAY_LENGTH)
        .map((entry) => sanitizeJsonValue(entry))
    : undefined;
  const error = payload.error === undefined ? undefined : sanitizeJsonValue(payload.error);
  const message =
    sanitizeOptionalString(payload.message) ??
    (args ? getMessageFromArgs(args) : null) ??
    (error ? truncateString(JSON.stringify(error)) : null);
  const timestamp =
    sanitizeOptionalString(payload.timestamp, 100) ?? new Date().toISOString();
  const sequence =
    typeof payload.sequence === "number" && Number.isFinite(payload.sequence)
      ? payload.sequence
      : null;

  return {
    timestamp,
    sessionId: sanitizeOptionalString(payload.sessionId, 200),
    sequence,
    type: sanitizeOptionalString(payload.type, 100) ?? "console",
    level: sanitizeOptionalString(payload.level, 50) ?? "log",
    url: sanitizeOptionalString(payload.url, 4000),
    pathname: sanitizeOptionalString(payload.pathname, 2000),
    featureId: featureId ?? null,
    userAgent: sanitizeOptionalString(payload.userAgent, 1000) ?? requestUserAgent,
    message,
    ...(args && args.length > 0 ? { args } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

async function appendDebugRecords(
  records: BrowserDebugLogRecord[],
  logFilePath: string,
): Promise<void> {
  await appendJsonlRecords(logFilePath, "browser-debug", records);
}

export function injectBrowserDebugScript(html: string): string {
  if (html.includes(DEBUG_SCRIPT_PATH)) {
    return html;
  }

  const scriptTag = `<script src="${DEBUG_SCRIPT_PATH}" data-fusebase-debug="true"></script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${scriptTag}</body>`);
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${scriptTag}</head>`);
  }

  return `${html}${scriptTag}`;
}

export async function handleBrowserDebugRequest(
  req: Request,
  options?: {
    featureId?: string;
    logFilePath?: string;
  },
): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname === DEBUG_SCRIPT_PATH) {
    return new Response(BROWSER_DEBUG_SCRIPT, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (pathname !== DEBUG_LOG_PATH) {
    return null;
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "POST" },
    });
  }

  try {
    const rawBody = await req.text();
    const payload = rawBody ? (JSON.parse(rawBody) as unknown) : null;
    const inputs = getEventInputs(payload);
    if (inputs.length === 0) {
      return new Response("Invalid debug payload", { status: 400 });
    }

    const records = inputs
      .map((input) =>
        normalizeEvent(
          input,
          options?.featureId,
          sanitizeOptionalString(req.headers.get("user-agent"), 1000),
        ),
      )
      .filter((record) => JSON.stringify(record).length <= MAX_EVENT_BYTES);

    if (records.length === 0) {
      return new Response(null, { status: 204 });
    }

    await appendDebugRecords(
      records,
      options?.logFilePath ?? "browser-debug.log",
    );
  } catch (error) {
    logger.error({ error }, "Failed to persist browser debug event");
  }

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}
