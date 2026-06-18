import { describe, expect, it } from "bun:test";

import {
  resolveBaseUrl,
  resolveManifestUrl,
  resolveLatestVersion,
  fetchManifest,
  type Manifest,
} from "../lib/remote-version";

const PROD_BASE = "https://fusebase-cli-bin.s3.us-east-1.amazonaws.com";
const PROD_MANIFEST = `${PROD_BASE}/manifest.json`;

const ALLOW = { FUSEBASE_ALLOW_INSECURE_UPDATE_ENDPOINT: "1" };

describe("endpoint overrides", () => {
  it("env override wins for the base URL when opt-in is set (accepts http://)", () => {
    expect(
      resolveBaseUrl({ ...ALLOW, FUSEBASE_UPDATE_BASE_URL: "http://192.168.1.5:8000" }),
    ).toBe("http://192.168.1.5:8000");
  });

  it("env override wins for the manifest URL when opt-in is set", () => {
    expect(
      resolveManifestUrl({
        ...ALLOW,
        FUSEBASE_MANIFEST_URL: "http://192.168.1.5:8000/manifest.json",
      }),
    ).toBe("http://192.168.1.5:8000/manifest.json");
  });

  it("ignores the overrides when the opt-in flag is absent", () => {
    expect(resolveBaseUrl({ FUSEBASE_UPDATE_BASE_URL: "http://192.168.1.5:8000" })).toBe(
      PROD_BASE,
    );
    expect(
      resolveManifestUrl({ FUSEBASE_MANIFEST_URL: "http://192.168.1.5:8000/manifest.json" }),
    ).toBe(PROD_MANIFEST);
  });

  it("falls back to the prod default when unset", () => {
    expect(resolveBaseUrl({})).toBe(PROD_BASE);
    expect(resolveManifestUrl({})).toBe(PROD_MANIFEST);
  });
});

describe("resolveLatestVersion", () => {
  const base: Manifest = {
    version: "0.25.6",
    devVersion: "2026.061510.5446",
    date: "2026-06-15",
    comment: "",
  };

  it("picks devVersion on the dev channel", () => {
    expect(resolveLatestVersion(base, "dev")).toBe("2026.061510.5446");
  });

  it("picks version on the prod channel", () => {
    expect(resolveLatestVersion(base, "prod")).toBe("0.25.6");
  });

  it("falls back to version on dev when devVersion is absent", () => {
    expect(resolveLatestVersion({ ...base, devVersion: undefined }, "dev")).toBe("0.25.6");
  });
});

describe("manifest parsing", () => {
  it("preserves launcherVersion through fetchManifest", async () => {
    const fixture: Manifest = {
      version: "0.25.6",
      devVersion: "2026.061510.5446",
      launcherVersion: "2026.061508.1200",
      date: "2026-06-15",
      comment: "",
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    try {
      const manifest = await fetchManifest();
      expect(manifest.launcherVersion).toBe("2026.061508.1200");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
