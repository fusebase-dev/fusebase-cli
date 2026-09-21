import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyAgentsAndSkills } from "../lib/copy-template";

const LIFECYCLE = ".claude/skills/file-upload/references/upload-lifecycle.md";

// The rule the template shipped inside the custom block before NIM-43290. An app
// created back then still carries it, and the merge restores its block verbatim.
const LEGACY_RULE =
  "- Use the Gate `startMultipartFileUpload` -> direct `PUT` -> `completeMultipartFileUpload` flow for non-note file uploads.";

const APP_ADDITION = "- Our app stores invoice PDFs under the `invoices/` folder.";

const SEEDED_DOCUMENT = `# Upload Lifecycle

## Canonical Flow

1. Create a temp file and capture \`tempStoredFileName\`.

<!-- CUSTOM:SKILL:BEGIN -->
## Flow Selection Rule

- Use the \`web-editor/file/v2-upload\` -> \`bucket-files/create-relative\` flow for files uploaded as note attachments.
${LEGACY_RULE}
- When a note needs a readable image/file URL after upload, keep the note attachment lifecycle on the web-editor flow and use the resulting file descriptor or URL returned by that flow.

## App attachment storage (non-negotiable)

${APP_ADDITION}
<!-- CUSTOM:SKILL:END -->

## Display URLs
`;

describe("file-upload skill upgrade", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fusebase-upgrade-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const lifecycle = () => readFileSync(join(dir, LIFECYCLE), "utf-8");

  it("gives a fresh app only the presigned default", async () => {
    await copyAgentsAndSkills(dir);

    expect(lifecycle()).not.toContain(LEGACY_RULE);
    expect(lifecycle()).toContain("**Presigned single PUT**");
  });

  it("drops the superseded rule from an existing app and keeps its own additions", async () => {
    mkdirSync(join(dir, ".claude/skills/file-upload/references"), { recursive: true });
    writeFileSync(join(dir, LIFECYCLE), SEEDED_DOCUMENT, "utf-8");

    await copyAgentsAndSkills(dir);

    const text = lifecycle();
    expect(text).not.toContain(LEGACY_RULE);
    expect(text).not.toContain("## Flow Selection Rule");
    expect(text).toContain("**Presigned single PUT**");
    expect(text).toContain(APP_ADDITION);
  });
});
