import { describe, expect, it } from "bun:test";

import { extractCustomBlocks, mergeCustomBlocks } from "../lib/copy-template";

const BEGIN = "<!-- CUSTOM:SKILL:BEGIN -->";
const END = "<!-- CUSTOM:SKILL:END -->";

function countBlocks(content: string): number {
  return content.split(BEGIN).length - 1;
}

function occurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

describe("custom skill block restore", () => {
  it("restores a project block the template does not ship", () => {
    const project = [
      "# Skill",
      "",
      "## Backend",
      "",
      BEGIN,
      "Always call the gateway through `callAppApi`.",
      END,
      "",
      "## Authentication",
      "",
    ].join("\n");
    const updatedTemplate = ["# Skill", "", "## Backend", "", "## Authentication", ""].join("\n");

    const merged = mergeCustomBlocks(updatedTemplate, extractCustomBlocks(project));

    expect(countBlocks(merged)).toBe(1);
    expect(merged).toContain("Always call the gateway through `callAppApi`.");
    expect(merged.indexOf("Always call")).toBeGreaterThan(merged.indexOf("## Backend"));
    expect(merged.indexOf("Always call")).toBeLessThan(merged.indexOf("## Authentication"));
  });

  it("does not re-insert a block whose text the template now ships as plain markdown", () => {
    const body = "Always call the gateway through `callAppApi`.";
    const project = ["# Skill", "", "## Backend", "", BEGIN, body, END, ""].join("\n");
    // The guidance was promoted into the skill itself, without the custom markers.
    const updatedTemplate = ["# Skill", "", "## Backend", "", body, ""].join("\n");

    const merged = mergeCustomBlocks(updatedTemplate, extractCustomBlocks(project));

    expect(countBlocks(merged)).toBe(0);
    expect(occurrences(merged, body)).toBe(1);
  });

  it("ignores whitespace differences when deciding a block is already shipped", () => {
    const project = [
      "# Skill",
      "",
      BEGIN,
      "## Uploads   ",
      "",
      "",
      "Store `storedFileUUID`, never the bytes.",
      END,
      "",
    ].join("\r\n");
    const updatedTemplate = ["# Skill", "", "## Uploads", "", "Store `storedFileUUID`, never the bytes.", ""].join("\n");

    const merged = mergeCustomBlocks(updatedTemplate, extractCustomBlocks(project));

    expect(countBlocks(merged)).toBe(0);
    expect(occurrences(merged, "Store `storedFileUUID`, never the bytes.")).toBe(1);
  });

  it("restores a block only once when the project repeated it", () => {
    const body = "Never store base64 blobs in isolated SQL.";
    const project = [
      "# Skill",
      "",
      "## Storage",
      "",
      BEGIN,
      body,
      END,
      "",
      "## Limits",
      "",
      BEGIN,
      body,
      END,
      "",
    ].join("\n");
    const updatedTemplate = ["# Skill", "", "## Storage", "", "## Limits", ""].join("\n");

    const merged = mergeCustomBlocks(updatedTemplate, extractCustomBlocks(project));

    expect(countBlocks(merged)).toBe(1);
    expect(occurrences(merged, body)).toBe(1);
  });

  it("keeps a project block that only overlaps the shipped text", () => {
    const project = [
      "# Skill",
      "",
      "## Backend",
      "",
      BEGIN,
      "Always call the gateway through `callAppApi`, and log the correlation id.",
      END,
      "",
    ].join("\n");
    const updatedTemplate = [
      "# Skill",
      "",
      "## Backend",
      "",
      "Always call the gateway through `callAppApi`.",
      "",
    ].join("\n");

    const merged = mergeCustomBlocks(updatedTemplate, extractCustomBlocks(project));

    expect(countBlocks(merged)).toBe(1);
    expect(merged).toContain("log the correlation id");
  });
});
