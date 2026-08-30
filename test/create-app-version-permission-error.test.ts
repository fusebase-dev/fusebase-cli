import { afterEach, describe, expect, it } from "bun:test";

import { ApiError, createAppVersion } from "../lib/api";

// A 403 from the version-create API used to reach the user as a bare message,
// so `deploy` could not tell a permission problem from a server failure and
// printed the generic 500 text (NIM-43992). The status now rides on the error.

const realFetch = global.fetch;

function stubFetch(status: number, body: unknown) {
  global.fetch = (async () =>
    ({
      ok: false,
      status,
      statusText: status === 403 ? "Forbidden" : "Internal Server Error",
      json: async () => body,
    }) as unknown as Response) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("createAppVersion error propagation", () => {
  it("carries the 403 status and the API message", async () => {
    stubFetch(403, { message: "Access denied" });

    const error = await createAppVersion("k", "org", "prod", "app").catch(
      (e) => e,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toContain("403 Forbidden");
    expect((error as ApiError).message).toContain("Access denied");
  });

  it("keeps a real server failure on its own status", async () => {
    stubFetch(500, {});

    const error = await createAppVersion("k", "org", "prod", "app").catch(
      (e) => e,
    );

    expect((error as ApiError).status).toBe(500);
  });
});
