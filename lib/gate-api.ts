import { getFusebaseHost } from "./config";

export type GateServiceRequestOptions = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
};

export function getGateServiceBaseUrl(): string {
  return `https://app-api.${getFusebaseHost()}/v4/api/proxy/gate-service/v1`;
}

export async function requestGateService<T>(
  gateToken: string,
  options: GateServiceRequestOptions,
): Promise<T> {
  const normalizedPath = options.path.startsWith("/")
    ? options.path
    : `/${options.path}`;
  const url = new URL(`${getGateServiceBaseUrl()}${normalizedPath}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: options.method,
    headers: {
      "x-gate-token": gateToken,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const details = body.trim() ? `\n${body}` : "";
    throw new Error(
      `Gate service request failed: ${options.method} ${url.pathname} ${response.status} ${response.statusText}${details}`,
    );
  }

  return (await response.json()) as T;
}
