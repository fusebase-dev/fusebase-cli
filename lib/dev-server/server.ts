import { createServer } from "net";
import { fetchFeatureToken } from "../api";
import { handleBrowserDebugRequest, injectBrowserDebugScript } from "./browser-debug";
import { getConfig, loadFuseConfig } from "../config";
import { Agent, fetch } from "undici";
import { logger } from "../logger";
import {
  createJsonlAppender,
  createRequestId,
  isApiPath,
  sanitizeHeaders,
  sanitizeJsonValue,
  summarizeRequestBody,
  summarizeResponseBody,
  type DevSessionLogPaths,
  type JsonlAppender,
  type JsonValue,
} from "./dev-debug-logs";
import { handleWebSocketUpgrade, websocketHandler, type WebSocketProxyData } from "./websockets";

// Cookie name for feature token
const FEATURE_TOKEN_COOKIE = "fbsfeaturetoken";
type ProxyResponse = Awaited<ReturnType<typeof fetch>>;

// Wrapper type for dev server
export interface DevServer {
  port: number;
  close: () => Promise<void>;
}

async function isPortAvailable(port: number): Promise<boolean> {
  // trying to start server on the port on different hosts
  // if a single host is failed then port is busy
  const hosts = [undefined, '::', '::1', '0.0.0.0', '127.0.0.1', 'localhost']

  const checkHost = (host?: string) => {
    return new Promise<boolean>((resolve) => {
      const server = createServer();
      server.on("error", (err) => {
        resolve(false)
      });
      const callback = () => {
        server.close(() => resolve(true));
      }
      if (host) {
        server.listen(port, host, callback);
      } else {
        server.listen(port, callback);
      }
    })
  }

  for (const host of hosts) {
    const result = await checkHost(host)
    if (!result) {
      return false;
    }
  }

  return true;
}

export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  let attempts = 0;
  while (attempts < 1000) {
    if (port === 4190) {
      // Firefox complaints about this port
      port++;
      continue;
    }
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
    attempts++;
  }
  throw new Error(`Could not find available port starting from ${startPort}`);
}

export interface DevUrlState {
  url: string | null;
}

interface ApiRequestContext {
  isApiRequest: boolean;
  requestId: string | null;
  requestStartTime: number;
  pathname: string;
  query: string;
  requestHeaders: Record<string, string> | null;
  requestBody: JsonValue | string | null;
}

interface ProxyRequestOptions {
  req: Request;
  url: URL;
  featureUrl: string;
  selectedFeatureId?: string;
  apiContext: ApiRequestContext;
  appendAccessLogRecord: JsonlAppender;
  proxyAgent: Agent;
}

function createWaitingForFeatureResponse(): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <title>Fusebase Dev Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
    h1 { color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <h1>⏳ Waiting for feature dev server...</h1>
  <p>The feature's dev server URL has not been detected yet.</p>
  <p>Make sure your feature has a <code>dev.command</code> in fusebase.json.</p>
  <script>setTimeout(() => location.reload(), 2000);</script>
</body>
</html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function createProxyErrorResponse(
  featureUrl: string,
  requestId: string | null,
): Response {
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <title>Fusebase Dev Server - Error</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
    h1 { color: #c00; }
    p { color: #666; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>❌ Connection Error</h1>
  <p>Could not connect to feature dev server at <code>${featureUrl}</code></p>
  <p>Make sure your feature's dev server is running.</p>
  <script>setTimeout(() => location.reload(), 2000);</script>
</body>
</html>`,
    {
      status: 502,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...(requestId ? { "x-fusebase-dev-request-id": requestId } : {}),
      },
    },
  );
}

async function createApiRequestContext(
  req: Request,
  url: URL,
): Promise<ApiRequestContext> {
  const isApiRequest = isApiPath(url.pathname);
  const requestId = isApiRequest ? createRequestId() : null;
  const requestStartTime = Date.now();
  let requestBody: JsonValue | string | null = null;

  if (isApiRequest) {
    try {
      requestBody = await summarizeRequestBody(req);
    } catch {
      requestBody = "[omitted: failed to parse request body]";
    }
  }

  return {
    isApiRequest,
    requestId,
    requestStartTime,
    pathname: url.pathname,
    query: url.search,
    requestHeaders: isApiRequest ? sanitizeHeaders(req.headers) : null,
    requestBody,
  };
}

/**
 * Writes the incoming `/api` request record into the access log.
 * @param appendAccessLogRecord JSONL appender for `access-logs.jsonl`.
 * @param apiContext Normalized request data prepared once per request.
 * @param req Original incoming request.
 * @param selectedFeatureId Selected feature id for correlation in logs.
 */
function appendApiRequestLog(
  appendAccessLogRecord: JsonlAppender,
  apiContext: ApiRequestContext,
  req: Request,
  selectedFeatureId?: string,
): void {
  if (!apiContext.isApiRequest || !apiContext.requestId) {
    return;
  }

  appendAccessLogRecord.append({
    timestamp: new Date().toISOString(),
    type: "request",
    featureId: selectedFeatureId ?? null,
    requestId: apiContext.requestId,
    method: req.method,
    pathname: apiContext.pathname,
    query: apiContext.query,
    requestHeaders: apiContext.requestHeaders ?? {},
    ...(apiContext.requestBody !== null ? { requestBody: apiContext.requestBody } : {}),
  });
}

/**
 * Writes a proxy failure record for a logged `/api` request.
 * @param appendAccessLogRecord JSONL appender for `access-logs.jsonl`.
 * @param apiContext Normalized request data prepared once per request.
 * @param req Original incoming request.
 * @param error Proxy failure that should be serialized into the log.
 * @param selectedFeatureId Selected feature id for correlation in logs.
 */
function appendApiProxyErrorLog(
  appendAccessLogRecord: JsonlAppender,
  apiContext: ApiRequestContext,
  req: Request,
  error: unknown,
  selectedFeatureId?: string,
): void {
  if (!apiContext.isApiRequest || !apiContext.requestId) {
    return;
  }

  appendAccessLogRecord.append({
    timestamp: new Date().toISOString(),
    type: "proxy-error",
    featureId: selectedFeatureId ?? null,
    requestId: apiContext.requestId,
    method: req.method,
    pathname: apiContext.pathname,
    query: apiContext.query,
    durationMs: Date.now() - apiContext.requestStartTime,
    error:
      error instanceof Error
        ? sanitizeJsonValue(error)
        : { message: String(error) },
  });
}

function createProxyHeaders(
  req: Request,
  requestUrl: URL,
  requestId: string | null,
): Headers {
  const proxyHeaders = new Headers();

  for (const [key, value] of req.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (lowerKey !== "host" && lowerKey !== "connection") {
      proxyHeaders.set(key, value);
    }
  }

  proxyHeaders.set("x-forwarded-host", requestUrl.host);
  proxyHeaders.set("x-forwarded-proto", "http");
  if (requestId) {
    proxyHeaders.set("x-fusebase-dev-request-id", requestId);
  }

  return proxyHeaders;
}

function createProxyResponseHeaders(
  proxyResponse: ProxyResponse,
  requestId: string | null,
): Headers {
  const responseHeaders = new Headers();

  for (const [key, value] of proxyResponse.headers.entries()) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey !== "transfer-encoding" &&
      lowerKey !== "connection" &&
      lowerKey !== "keep-alive"
    ) {
      responseHeaders.set(key, value);
    }
  }

  if (requestId) {
    responseHeaders.set("x-fusebase-dev-request-id", requestId);
  }

  return responseHeaders;
}

/**
 * Writes the outgoing `/api` response record into the access log.
 * @param appendAccessLogRecord JSONL appender for `access-logs.jsonl`.
 * @param apiContext Normalized request data prepared once per request.
 * @param req Original incoming request.
 * @param proxyResponse Response returned from the proxied dev server.
 * @param responseHeaders Headers that will be returned to the browser.
 * @param durationMs Proxy round-trip duration in milliseconds.
 * @param selectedFeatureId Selected feature id for correlation in logs.
 */
async function appendApiResponseLog(
  appendAccessLogRecord: JsonlAppender,
  apiContext: ApiRequestContext,
  req: Request,
  proxyResponse: ProxyResponse,
  responseHeaders: Headers,
  durationMs: number,
  selectedFeatureId?: string,
): Promise<void> {
  if (!apiContext.isApiRequest || !apiContext.requestId) {
    return;
  }

  let responseBody: JsonValue | string | null = null;
  try {
    responseBody = await summarizeResponseBody(proxyResponse, req.method);
  } catch {
    responseBody = "[omitted: failed to parse response body]";
  }

  appendAccessLogRecord.append({
    timestamp: new Date().toISOString(),
    type: "response",
    featureId: selectedFeatureId ?? null,
    requestId: apiContext.requestId,
    method: req.method,
    pathname: apiContext.pathname,
    query: apiContext.query,
    status: proxyResponse.status,
    durationMs,
    responseHeaders: sanitizeHeaders(responseHeaders),
    ...(responseBody !== null ? { responseBody } : {}),
  });
}

async function maybeRewriteHtmlResponse(
  req: Request,
  proxyResponse: ProxyResponse,
  responseHeaders: Headers,
  selectedFeatureId?: string,
): Promise<Response | null> {
  const contentType = proxyResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return null;
  }

  const config = await getConfig();
  const fuseConfig = await loadFuseConfig();

  if (!config.apiKey || !fuseConfig?.orgId || !fuseConfig?.appId) {
    console.warn("Warning: Missing config for fetching feature token.");
    console.warn("Config API key set?", config.apiKey ? "yes" : "no");
    console.warn("Fusebase config orgId:", fuseConfig?.orgId);
    console.warn("Fusebase config appId:", fuseConfig?.appId);
    throw new Error("Missing configuration for fetching feature token.");
  }

  const tokenStartTime = Date.now();
  const tokenResponse = await fetchFeatureToken(
    config.apiKey,
    fuseConfig.orgId,
    fuseConfig.appId,
    selectedFeatureId || "",
  );
  const tokenDurationMs = Date.now() - tokenStartTime;
  if (tokenDurationMs > 1000) {
    logger.warn(`⚠️  Slow response from fetchFeatureToken: ${tokenDurationMs}ms`);
  }

  if (tokenResponse.token) {
    responseHeaders.set(
      "Set-Cookie",
      `${FEATURE_TOKEN_COOKIE}=${tokenResponse.token}; Path=/; SameSite=Lax`,
    );
  }

  if (req.method === "HEAD") {
    return null;
  }

  const html = await proxyResponse.text();
  const rewrittenHtml = injectBrowserDebugScript(html);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("etag");

  return new Response(rewrittenHtml, {
    status: proxyResponse.status,
    statusText: proxyResponse.statusText,
    headers: responseHeaders,
  });
}

async function proxyFeatureRequest({
  req,
  url,
  featureUrl,
  selectedFeatureId,
  apiContext,
  appendAccessLogRecord,
  proxyAgent,
}: ProxyRequestOptions): Promise<Response> {
  const requestUrl = new URL(req.url);
  const targetUrl = new URL(requestUrl.pathname + requestUrl.search, featureUrl);
  const proxyHeaders = createProxyHeaders(req, url, apiContext.requestId);
  const proxyStartTime = Date.now();
  const proxyResponse = await fetch(targetUrl.toString(), {
    dispatcher: proxyAgent,
    method: req.method,
    headers: proxyHeaders,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    redirect: "manual",
  });
  const durationMs = Date.now() - proxyStartTime;

  if (durationMs > 1000) {
    logger.warn(
      `⚠️  Slow response from feature dev server: ${durationMs}ms for ${req.method} ${targetUrl}`,
    );
  }

  const responseHeaders = createProxyResponseHeaders(
    proxyResponse,
    apiContext.requestId,
  );

  if (!apiContext.isApiRequest && responseHeaders.get("content-type")?.includes("text/html")) {
    // log non-api html request in access log
    appendAccessLogRecord.append({
      message: `${req.method} ${url.pathname} proxied to ${targetUrl} (${durationMs}ms)`,
    })
  }

  await appendApiResponseLog(
    appendAccessLogRecord,
    apiContext,
    req,
    proxyResponse,
    responseHeaders,
    durationMs,
    selectedFeatureId,
  );

  const rewrittenHtmlResponse = await maybeRewriteHtmlResponse(
    req,
    proxyResponse,
    responseHeaders,
    selectedFeatureId,
  );
  if (rewrittenHtmlResponse) {
    return rewrittenHtmlResponse;
  }

  return new Response(proxyResponse.body, {
    status: proxyResponse.status,
    statusText: proxyResponse.statusText,
    headers: responseHeaders,
  });
}

// Start the dev server (API + simple UI)
export async function startDevServer(
  logPaths: DevSessionLogPaths,
  port: number = 4174,
  selectedFeatureId?: string,
  devUrlState?: DevUrlState,
  backendPort?: number,
): Promise<DevServer> {
  const actualPort = await findAvailablePort(port);
  const browserDebugLogPath = logPaths.browserDebugPath;
  const appendAccessLogRecord = createJsonlAppender(
    logPaths.accessLogsPath,
    "access-logs",
  );

  const proxyAgent = new Agent({
    keepAliveTimeout: 1000, // Close idle sockets after 1 second
    keepAliveMaxTimeout: 2000,
    connections: 100, // Max concurrent sockets to your target
  });

  const server = Bun.serve<WebSocketProxyData>({
    port: actualPort,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Handle WebSocket upgrade for /api paths
      const wsResponse = handleWebSocketUpgrade(req, url, server, backendPort);
      if (wsResponse !== null) return wsResponse;

      const apiContext = await createApiRequestContext(req, url);

      appendApiRequestLog(
        appendAccessLogRecord,
        apiContext,
        req,
        selectedFeatureId,
      );

      const browserDebugResponse = await handleBrowserDebugRequest(
        req,
        {
          featureId: selectedFeatureId,
          logFilePath: browserDebugLogPath,
        },
      );
      if (browserDebugResponse) {
        return browserDebugResponse;
      }

      // Proxy /api requests to the backend when a backend is configured
      if (backendPort && isApiPath(url.pathname)) {
        const backendUrl = `http://localhost:${backendPort}`;
        try {
          return await proxyFeatureRequest({
            req,
            url,
            featureUrl: backendUrl,
            selectedFeatureId,
            apiContext,
            appendAccessLogRecord,
            proxyAgent,
          });
        } catch (error) {
          appendApiProxyErrorLog(
            appendAccessLogRecord,
            apiContext,
            req,
            error,
            selectedFeatureId,
          );

          console.error("Proxy error to backend dev server:", error);
          return createProxyErrorResponse(backendUrl, apiContext.requestId);
        }
      }

      // Reverse proxy to feature dev URL
      const featureUrl = devUrlState?.url;
      if (!featureUrl) {
        appendApiProxyErrorLog(
          appendAccessLogRecord,
          apiContext,
          req,
          new Error("Feature dev server URL has not been detected yet"),
          selectedFeatureId,
        );

        return createWaitingForFeatureResponse();
      }

      try {
        return await proxyFeatureRequest({
          req,
          url,
          featureUrl,
          selectedFeatureId,
          apiContext,
          appendAccessLogRecord,
          proxyAgent,
        });
      } catch (error) {
        appendApiProxyErrorLog(
          appendAccessLogRecord,
          apiContext,
          req,
          error,
          selectedFeatureId,
        );

        console.error("Proxy error to feature dev server:", error);
        return createProxyErrorResponse(featureUrl, apiContext.requestId);
      }
    },
    websocket: websocketHandler,
  });

  console.log(`🚀 Dev server running at http://localhost:${server.port} (proxying to feature dev server)`);

  return {
    port: server.port!,
    close: async () => {
      server.stop();
    },
  };
}
