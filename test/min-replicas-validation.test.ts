import { describe, expect, it } from "bun:test";

import { MAX_MIN_REPLICAS, validateMinReplicas } from "../lib/config";

// Client-side guard for `backend.minReplicas` (NIM-41536). Mirrors the
// authoritative nimbus-ai cap so deploys fail fast with a friendly message.
describe("validateMinReplicas", () => {
  it("treats an absent value as no-op", () => {
    expect(() => validateMinReplicas(undefined)).not.toThrow();
    expect(() => validateMinReplicas(null)).not.toThrow();
  });

  it("accepts 0 (scale-to-zero) through the cap", () => {
    for (const v of [0, 1, 2, MAX_MIN_REPLICAS]) {
      expect(() => validateMinReplicas(v)).not.toThrow();
    }
  });

  it("rejects values above the cap", () => {
    expect(() => validateMinReplicas(MAX_MIN_REPLICAS + 1)).toThrow(
      /between 0 and 3/,
    );
  });

  it("rejects negative values", () => {
    expect(() => validateMinReplicas(-1)).toThrow(/between 0 and 3/);
  });

  it("rejects non-integers", () => {
    expect(() => validateMinReplicas(1.5)).toThrow(/between 0 and 3/);
    expect(() => validateMinReplicas(Number.NaN)).toThrow(/between 0 and 3/);
  });

  it("rejects non-number types", () => {
    expect(() => validateMinReplicas("1")).toThrow(/between 0 and 3/);
    expect(() => validateMinReplicas(true)).toThrow(/between 0 and 3/);
  });

  it("names the app in the error when provided", () => {
    expect(() => validateMinReplicas(4, "my-app")).toThrow(
      'backend.minReplicas for app "my-app" must be an integer between 0 and 3',
    );
  });
});
