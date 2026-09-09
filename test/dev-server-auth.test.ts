import { describe, expect, it } from "bun:test";
import {
  buildDevAuthResponse,
  isDevAuthPath,
} from "../lib/dev-server/server.ts";

const TOKEN = "local-app-token";

function authRequest(search: string, accept?: string): Request {
  return new Request(`http://localhost:4174/_auth/${search}`, {
    headers: accept ? { Accept: accept } : {},
  });
}

describe("dev server /_auth/", () => {
  it("matches the path with and without the trailing slash", () => {
    expect(isDevAuthPath("/_auth")).toBe(true);
    expect(isDevAuthPath("/_auth/")).toBe(true);
    expect(isDevAuthPath("/_authx")).toBe(false);
  });

  it("answers JSON with the app-wrapper field names when JSON is asked for", async () => {
    const res = buildDevAuthResponse(
      authRequest("?url=%2Fdashboard&se=whatever", "application/json"),
      TOKEN,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBe(
      `fbsfeaturetoken=${TOKEN}; Path=/; SameSite=Lax`,
    );
    expect(await res.json()).toEqual({
      status: "ok",
      redirectPath: "/dashboard",
      token: TOKEN,
      expiresInSeconds: 86400,
    });
  });

  it("redirects a plain navigation to the url query param", () => {
    const res = buildDevAuthResponse(
      authRequest("?url=%2Fdashboard&se=whatever", "text/html"),
      TOKEN,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    expect(res.headers.get("Set-Cookie")).toBe(
      `fbsfeaturetoken=${TOKEN}; Path=/; SameSite=Lax`,
    );
  });

  it.each([
    ["an absolute url", "https://evil.example"],
    ["a protocol-relative url", "//evil.example"],
    ["a backslash url", "/\\evil.example"],
    ["a tab-smuggled url", "/\t/evil.example"],
    ["a dot-segment url that normalizes to protocol-relative", "/..//evil.example"],
    ["a host-relative url app-wrapper rejects", "dashboard"],
    ["a query-only url app-wrapper rejects", "?x=1"],
    ["a fragment-only url app-wrapper rejects", "#frag"],
    ["a single-slash scheme url app-wrapper rejects", "http:/evil.example"],
  ])("rejects %s", async (_name, value) => {
    const res = buildDevAuthResponse(
      authRequest(`?url=${encodeURIComponent(value)}`, "application/json"),
      TOKEN,
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(await res.json()).toMatchObject({ reason: "invalid_redirect_url" });
  });

  it("fails loudly when the local token is empty", () => {
    expect(() =>
      buildDevAuthResponse(authRequest("?url=%2Fdashboard"), ""),
    ).toThrow();
  });
});
