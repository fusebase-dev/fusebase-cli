import { afterEach, describe, expect, it } from "bun:test";
import { sendCodingStatsForCreatedApp } from "../lib/api";

// NIM-41997: in declarative mode `app create` no longer creates the app, so the
// coding-agent/model tracking is sent when deploy/dev-start creates it. This
// covers the guard: fire once when tracking exists, no-op when it doesn't.

describe("sendCodingStatsForCreatedApp", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubFetch() {
    const calls: unknown[] = [];
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    return calls;
  }

  it("no-ops when neither codingAgent nor model is set", async () => {
    const calls = stubFetch();
    sendCodingStatsForCreatedApp("key", "org", "prod", "app-1", {});
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  it("sends when tracking is present", async () => {
    const calls = stubFetch();
    sendCodingStatsForCreatedApp("key", "org", "prod", "app-1", {
      codingAgent: "claude_code",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
  });
});
