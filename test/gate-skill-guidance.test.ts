import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const projectRoot = resolve(import.meta.dir, "..", "project-template");

function read(...parts: string[]): string {
  return readFileSync(join(projectRoot, ...parts), "utf8");
}

function readTemplateFile(...parts: string[]): string {
  return read(".claude/skills/fusebase-gate", ...parts);
}

describe("fusebase-gate template guidance", () => {
  it("tells generated apps to gate membership through getMyOrgAccess", () => {
    // The getMyOrgAccess verification guidance lives in the topic reference files
    // (membership/sdk/users). The generated SKILL.md entrypoint is a link index
    // and no longer duplicates it, so this test guards the references directly.
    const membership = readTemplateFile("references", "membership.md");
    const sdk = readTemplateFile("references", "sdk.md");
    const users = readTemplateFile("references", "users.md");

    expect(membership).toContain("Never unlock org UI from addOrgUser success alone; confirm with getMyOrgAccess.");
    expect(membership).toContain("`result: \"invite\"` means an invite record exists, not that the current session already has org access.");

    expect(sdk).toContain("After sign-up, sign-in, or provisioning writes, re-check AccessApi.getMyOrgAccess before unlocking org content.");
    // Assert the durable safety clause rather than the full sentence — these
    // references are synced from upstream MCP prompts and get reworded (the
    // `/me` phrasing has already drifted once).
    expect(sdk).toContain("as the source of truth unless it delegates to getMyOrgAccess.");

    expect(users).toContain("A 201 from addOrgUser is not proof that the current session or target user already has org access.");
    expect(users).toContain("For access gating after provisioning, verify with getMyOrgAccess instead of inferring from addOrgUser success.");
  });
});

describe("file upload guidance", () => {
  const lifecycle = () => read(".claude/skills/file-upload/references/upload-lifecycle.md");
  const gateFiles = () => readTemplateFile("references", "files.md");

  it("names all three upload flows and when each applies", () => {
    const text = lifecycle();
    expect(text).toContain("createTempStoredFileUpload");
    expect(text).toContain("startMultipartFileUpload");
    expect(text).toContain("web-editor/file/v2-upload");
    // The presigned PUT carries exactly the headers the operation returns —
    // `content-type` and nothing else. Both halves are easy to get wrong and
    // neither is debuggable from the browser: dropping it stores the wrong media
    // type, adding anything else fails as an opaque CORS/network error.
    expect(text).toContain("exactly the headers the operation returns");
    expect(text).toContain("saveStoredFile: false");
    expect(text).not.toContain("Do not add `Content-Type`");
  });

  it("documents the bucket attachment operations and the accessPrincipals mapping", () => {
    const text = lifecycle();
    for (const op of ["createBucketAttachment", "updateBucketAttachment", "listBucketAttachments"]) {
      expect(text).toContain(op);
    }
    // The three visibility choices from the story, as accessPrincipals payloads.
    // The team is every org role except `client`, so `guest` belongs in the list.
    expect(text).toContain('{roles: ["owner", "manager", "member", "guest"]}');
    expect(text).toContain("All clients and team");
    expect(text).toContain("groupIds");
    // The field is `accessPrincipals`; the old bare `principals` name never
    // existed on a released gate, so no app should ever see it.
    expect(text).toContain("accessPrincipals");
    expect(text).not.toMatch(/(?<![A-Za-z])`principals`/);
    // NIM-44834: the frontend may create an attachment through the Gate proxy,
    // and it records a different uploader than the backend path.
    expect(text).toContain("app frontend can call it directly through the app-api Gate proxy");
    expect(text).toContain("recorded uploader is the signed-in");
  });

  it("documents the listBucketAttachments attributes filter with an example", () => {
    const text = lifecycle();
    // A JSON object sent as a string, every pair matched exactly — an app that
    // passes the object itself gets a 400 it cannot read from the skill.
    expect(text).toContain("a JSON object of strings, sent as a string");
    expect(text).toContain("Every pair must match the file exactly");
    expect(text).toContain('JSON.stringify({ source: "app" })');
    // The SDK takes the org in `path` and the filter in `query`; a top-level
    // `attributes` is a TS error and a client-side 400 before any HTTP call.
    expect(text).toContain("path: { orgId }");
    expect(text).toContain(
      'query: { attributes: JSON.stringify({ source: "app" }), limit: 50 }',
    );
  });

  it("keeps the synced gate reference in step with the new operations", () => {
    // The reference is regenerated from the gate MCP prompt; if a regen drops
    // an operation, the skill above would point at something apps cannot call.
    const text = gateFiles();
    for (const op of [
      "createTempStoredFileUpload",
      "createBucketAttachment",
      "updateBucketAttachment",
      "listBucketAttachments",
    ]) {
      expect(text).toContain(op);
    }
    // The presigned flow needs `content-type`; the reference must not still ban it
    // as an unsigned header, or an app has two rules and follows the wrong one.
    expect(text).toContain("the `headers` the upload operation returns are authoritative");
    expect(text).not.toContain("unsigned `Content-Type`");
    // The synced reference and the skill must agree on the field name and on
    // the listing filter, or an app follows whichever it read last.
    expect(text).toContain("accessPrincipals");
    expect(text).not.toMatch(/(?<![A-Za-z])`principals`/);
    expect(text).toContain("`attributes` is a JSON object of strings sent as a string");
  });
});

describe("app login handoff guidance", () => {
  // The handoff wording is security wording: it tells an app author what the
  // exchange token actually is. Most of these files are re-synced from
  // fusebase-gate, so pin the durable claims rather than whole sentences.
  const reference = () => readTemplateFile("references", "fusebase-auth.md");
  const agents = () => read("AGENTS.md");
  const inviteSkill = () => read(".claude/skills/invite-with-password/SKILL.md");

  // The criterion is written over the directory, not over a file list: rounds 3
  // to 6 each found one more file a hand-kept list had missed. Walk it instead,
  // and strip backticks so a phrase is caught however it is marked up.
  // Skipped: what project-template/.gitignore ignores, so a local build does
  // not add compiled copies the CI walk never sees.
  const notCommitted = new Set(["node_modules", "dist", "build", "out", "coverage"]);

  function everyTemplateFile(): { path: string; text: string }[] {
    const files: { path: string; text: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!notCommitted.has(entry.name)) walk(full);
        } else files.push({ path: full, text: readFileSync(full, "utf8").replaceAll("`", "") });
      }
    };
    walk(projectRoot);
    return files;
  }

  // Report the offending paths, so a failure names the file to fix.
  function expectNowhere(pattern: RegExp) {
    const offenders = everyTemplateFile()
      .filter(({ text }) => pattern.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  }

  // "single-use" is also how the portals reference describes a publish
  // confirmation, so that one ban is scoped to files that discuss the handoff
  // at all. Scoping it to the sentence was too narrow — a claim one sentence
  // away from the word "appAuth" walked straight through.
  function expectNowhereAboutTheToken(pattern: RegExp) {
    const offenders = everyTemplateFile()
      .filter(({ text }) => /appAuth|exchange ?[Tt]oken/.test(text) && pattern.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  }

  it("reads the whole template, so an absence check cannot pass vacuously", () => {
    const paths = everyTemplateFile().map(({ path }) => path);
    expect(paths.length).toBeGreaterThan(60);
    // The three files where the defects this suite bans actually lived.
    for (const tail of [
      ".claude/skills/fusebase-gate/references/fusebase-auth.md",
      ".claude/skills/invite-with-password/SKILL.md",
      "AGENTS.md",
    ]) {
      expect(paths.some((path) => path.endsWith(tail))).toBe(true);
    }
  });

  it("never calls the exchange token single-use", () => {
    // It is not: user-api-service resolves it with a bare redis.get and never
    // deletes the key, so it is replayable for its whole 300s TTL.
    expectNowhereAboutTheToken(/single-use|already spent|or spent/i);
  });

  it("never claims the exchange token is bound to one app", () => {
    // app-wrapper resolves the token by value alone and takes the app identity
    // from the request Host, so it mints on any app host that user can open.
    expectNowhere(/can only be spent/i);
  });

  it("never tells an app to hold a session id as a cookie", () => {
    // This subtask's first criterion, asked of the directory it is written about.
    // Two shapes: naming the cookie, and the imperative form the original defect
    // used ("set login.session.sessionId as the app-domain cookie") which names
    // no cookie at all. The prohibitions have to stay sayable — the reference
    // says "Never put a FuseBase session id in a cookie" — so the imperative ban
    // is judged per sentence and skips the negated ones.
    expectNowhere(/session (id|token)[^.]{0,60}eversessionid/i);

    const storesASessionId =
      /\b(set|store|keep|save|put|persist|write)\b.{0,80}\bsession[ .]?(id|sessionId|token)\b.{0,80}\b(cookie|localStorage|local storage|sessionStorage)/i;
    const prohibition = /\b(never|not|n't|no longer|avoid|instead of)\b/i;
    const offenders = everyTemplateFile()
      .filter(({ text }) =>
        text
          .split(/(?<=[.!?:])\s+|\n/)
          .some((sentence) => storesASessionId.test(sentence) && !prohibition.test(sentence)),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("says the token is replayable, on every surface an app author reads", () => {
    expect(reference()).toContain("replayable until it expires");
    expect(inviteSkill()).toContain("replayable until it expires");
    expect(agents()).toContain("Spending does not invalidate the token");
    // The token is not app-scoped either.
    expect(reference()).toContain("carries no binding to your app");
  });

  it("keeps the app token cookie as the only credential on an app host", () => {
    // Asserted on AGENTS.md only. The same claim used to be pinned as two exact
    // sentences in the synced reference, and a gate reword deleted both — the
    // ban above is what actually guards the criterion, and it reads the whole
    // directory rather than one upstream phrasing.
    expect(agents()).toContain(
      "**`fbsfeaturetoken` is the only credential on an app host.** The app never sets `eversessionid`",
    );
  });

  it("guards the worked example against a mint failure", () => {
    // appAuth is optional: with app_login_no_session_id off, a failed mint is a
    // 200 with the field absent, so an unguarded snippet throws on authPath.
    expect(inviteSkill()).toContain("if (!login.appAuth)");
    // app-wrapper's JSON errors always carry message and only sometimes reason.
    expect(inviteSkill()).toContain("showError(mint.message ?? mint.reason)");
  });

  it("makes the same-origin fetch the standard way to spend authPath", () => {
    // Navigation stays a documented fallback; what must not come back is the
    // SDK and the reference giving two different standard answers.
    // Case-insensitive: these files are regenerated from upstream prose, where
    // capitalising a sentence's first word is the smallest possible reword.
    expectNowhere(/navigate the browser/i);
    expect(agents()).toContain("same-origin `fetch(authPath");
    expect(inviteSkill()).toContain("Accept: 'application/json'");
  });
});
