import type { Server, ServerWebSocket } from "bun";

export interface WebSocketProxyData {
  targetUrl: string;
  headers: Record<string, string>;
  upstream: WebSocket | null;
  pendingMessages: (string | Buffer)[];
}

/**
 * Attempts to upgrade an incoming HTTP request to a WebSocket connection
 * if the path starts with /api. Returns a Response if handled, or null
 * if this request is not a WebSocket upgrade for /api.
 */
export function handleWebSocketUpgrade(
  req: Request,
  url: URL,
  server: Server<WebSocketProxyData>,
  backendPort: number | undefined,
): Response | undefined | null {
  if (
    req.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
    !url.pathname.startsWith("/api")
  ) {
    return null;
  }

  if (!backendPort) {
    return new Response("Backend dev server not configured", { status: 502 });
  }

  const targetUrl = new URL(
    url.pathname + url.search,
    `ws://localhost:${backendPort}`,
  ).toString();
  const headers: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  const featureToken = req.headers.get("x-app-feature-token");

  if (cookie) {
    headers.cookie = cookie;
  }

  if (featureToken) {
    headers["x-app-feature-token"] = featureToken;
  }

  const upgraded = server.upgrade(req, {
    data: { targetUrl, headers, upstream: null, pendingMessages: [] },
  });

  if (upgraded) return undefined;
  return new Response("WebSocket upgrade failed", { status: 400 });
}

export const websocketHandler = {
  open(ws: ServerWebSocket<WebSocketProxyData>) {
    const upstream = new WebSocket(ws.data.targetUrl, {
      headers: ws.data.headers,
    });

    upstream.addEventListener("open", () => {
      ws.data.upstream = upstream;
      for (const msg of ws.data.pendingMessages) {
        upstream.send(msg);
      }
      ws.data.pendingMessages = [];
    });
    upstream.addEventListener("message", (event) => {
      ws.send(event.data as string | Buffer);
    });
    upstream.addEventListener("close", (event) => {
      ws.close(event.code, event.reason);
    });
    upstream.addEventListener("error", () => {
      ws.close(1011, "Upstream WebSocket error");
    });
  },
  message(ws: ServerWebSocket<WebSocketProxyData>, message: string | Buffer) {
    const upstream = ws.data.upstream;
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.send(message);
    } else {
      ws.data.pendingMessages.push(message);
    }
  },
  close(ws: ServerWebSocket<WebSocketProxyData>, code: number, reason: string) {
    const upstream = ws.data.upstream;
    if (upstream && upstream.readyState === WebSocket.OPEN) {
      upstream.close(code, reason);
    }
  },
};
