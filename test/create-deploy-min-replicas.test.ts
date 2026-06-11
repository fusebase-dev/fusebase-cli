import { afterEach, describe, expect, it } from "bun:test";

import { createDeploy } from "../lib/api";

// `createDeploy` POSTs to the nimbus-ai deploy endpoint. We stub global.fetch
// to capture the request body and assert how `minReplicas` (ST-3) is wired:
// included only when set in fusebase.json; absent = "no change".

const realFetch = global.fetch;

function stubFetch(): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  global.fetch = (async (_url: string, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body ?? "{}"));
    return {
      ok: true,
      json: async () => ({ id: "deploy-1" }),
    } as unknown as Response;
  }) as typeof fetch;
  return () => captured;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("createDeploy minReplicas wiring", () => {
  it("includes minReplicas when set to 1", async () => {
    const body = stubFetch();
    await createDeploy("k", "org", "prod", "app", "v1", undefined, undefined, 1);
    expect(body().minReplicas).toBe(1);
  });

  it("includes explicit 0 (restore scale-to-zero)", async () => {
    const body = stubFetch();
    await createDeploy("k", "org", "prod", "app", "v1", undefined, undefined, 0);
    expect(body().minReplicas).toBe(0);
  });

  it("omits minReplicas when not provided (no change)", async () => {
    const body = stubFetch();
    await createDeploy("k", "org", "prod", "app", "v1", undefined, undefined);
    expect("minReplicas" in body()).toBe(false);
  });
});
