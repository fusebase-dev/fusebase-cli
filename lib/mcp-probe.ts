/**
 * Best-effort HTTP reachability check for MCP (Streamable HTTP) endpoints.
 * Many servers respond to GET with 405 or serve metadata; any TCP/TLS response counts as reachable.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

export type McpProbeResult =
  | { ok: true; status: number }
  | { ok: false; error: string };

export async function probeMcpHttpEndpoint(
  url: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<McpProbeResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream, */*",
    ...options?.headers,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers,
      redirect: "follow",
    });
    try {
      await res.arrayBuffer();
    } catch {
      // ignore body read errors; status is still meaningful
    }
    return { ok: true, status: res.status };
  } catch (e: unknown) {
    const err = e as { name?: string; message?: string };
    if (err?.name === "AbortError") {
      return { ok: false, error: "Connection timed out" };
    }
    return { ok: false, error: err?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}
