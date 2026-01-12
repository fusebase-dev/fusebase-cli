---
name: autonomous-feedback-loop
description: "Use when: (1) User wants to set up or improve a debug loop or runbook for the repo, (2) User asks to autonomously test or debug features or runtimes, (3) Building or maintaining DEBUG.md with only verified techniques, (4) User asks to verify or document debug, test, restart, or hot-reload methods for each runtime. Discover and document only proven methods; nothing goes into DEBUG.md until verified."
---

# Agent Skill: Autonomous Feedback Loop (Repo-Wide)

## Core Mission

Your job is to **discover and verify** working methods for autonomous debugging, testing, and iteration across every runtime in this repository.

**The rule is simple: nothing goes into DEBUG.md until you've proven it works.**

You must:

1. Identify all runtimes and environments in the repo
2. For each runtime, find methods to: observe (logs, probes), restart/reload, drive state, and verify behavior
3. **Test each method yourself** — run it, see it work, confirm the output
4. Only after successful verification, document the method in DEBUG.md

**Primary artifact:** `DEBUG.md` — a runbook containing **only verified, working** techniques in the workspace root. You should add a link to the DEBUG.md in the AGENTS.md / CLAUDE.md files, depending on the environment you are working in.

---

## Principles

1. **Verify before documenting**

    - Never write "you can use console.log here" unless you've added a console.log, ran the code, and saw the output.
    - Never write "fetch to debug server works" unless you've actually sent a fetch and received it on the server.
    - Every claim in DEBUG.md must be backed by your own test.

2. **Test, don't theorize**

    - "Should work" is not acceptable. "I ran it and here's the output" is the standard.
    - If a method fails during your test, do not document it (or document it as broken).

3. **Cover every runtime**

    - Backend, frontend, extension, worker, mobile — each environment needs its own verified debug/test path.
    - Some runtimes are injected by others or accessed by others (e.g., extension injects content scripts, frontend could be accesses via debug-WebSocket through backend, etc.). Map these relationships.

**Important:** Try to find how-eval approach for each runtime. You should be able to evaluate code snippets in realtime in each runtime to test your changes before committing them to the code and to get access to the runtime state and data to debug and test your changes. If there are no eval mechanisms, consider creating DebugEvalServer and bash scripts to make queries to this server.

4. **Find the fastest feedback loop**

    - Hot reload is problematic: you can never be sure if the new code is loaded or not
    - **Preferred model:** hot-eval first → then commit to code → rebuild → restart → verify
    - For each runtime, find:
        1. **Eval mechanism** — a way to test code snippets in realtime
        2. **Rebuild command** — how to recompile the code
        3. **Restart method** — how to restart the runtime with fresh code
    - This gives deterministic feedback: you KNOW when new code is running

5. **Automation over manual**

    - Scripted state setup > clicking through UI
    - Programmatic verification > eyeballing logs

6. **Safety**
    - Debug hooks must be dev-only, gated, and removable.
    - No secrets in logs, no production backdoors.

---

## Outputs

-   `DEBUG.md` — contains **only verified techniques**:

    -   Each runtime with its start/stop/restart commands (you ran them)
    -   Logging methods that work (you added a log, saw the output)
    -   Debug server / probe endpoints (you sent a request, received response)
    -   State driving methods (you ran the script/command, reached the state)
    -   Test commands (you ran them, they passed/failed as expected)

-   Optional:
    -   `./debug/*.{sh,js,py}` — helper scripts you created and tested
    -   `./debug/*.md` — extended notes on complex setups

---

## Your Workflow

### Phase 1: Discovery

Scan the repo to identify all runtimes:

-   Check manifests: `package.json`, `pnpm-lock.yaml`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.
-   Look for entry points: `main`, `index`, `server`, `worker`, `extension`, `content-script`
-   Map relationships: which runtime spawns/injects others?

For each runtime, note:

-   Name (e.g., `extension-host`, `content-script`, `api`, `web`)
-   Type (backend, frontend, extension, worker, injected script)
-   Language/framework
-   Entry point file
-   How it's started (direct command? spawned by parent? injected?)

**Do not write to DEBUG.md yet.** This is just reconnaissance.

---

### Phase 2: Verification Loop (the core of your work)

For each runtime, go through this cycle:

#### 2.1 Test: Can you start/stop/restart it?

```
1. Run the start command
2. Confirm it's running (check process, port, logs)
3. Stop it
4. Confirm it stopped
5. Restart it
6. Confirm it's back
```

✅ If all steps work → document the commands in DEBUG.md
❌ If something fails → try to fix it or note it as broken

#### 2.2 Test: Can you observe it? (logging)

```
1. Add a console.log / print / log statement to a file in this runtime
2. Trigger the code path (restart, refresh, call endpoint, etc.)
3. Find where the log appears (terminal, file, devtools, debug server)
4. Remove the test log
```

✅ If you saw your log → document the logging method in DEBUG.md
❌ If you can't see logs → investigate why, try alternatives

#### 2.3 Test: What's the eval/REPL mechanism?

For rapid iteration, find a way to execute code without rebuilding:

```
1. Find or create an eval endpoint (debug server, REPL, devtools console)
2. Send a test expression
3. Verify you get a response
4. Test that you can access runtime state (e.g., `core`, `ideContext`, globals)
```

✅ If eval works → document the exact command/method to use it
❌ If no eval available → **CREATE ONE**

**Important:** Eval is critical for autonomous work. If a runtime doesn't have eval out of the box, you should build it:

-   Create a simple dev server inside the process that accepts HTTP requests
-   The server receives code/expression, executes it in local scope, returns result
-   This is achievable in almost any environment (Node, browser, Python, etc.)
-   Example: HTTP endpoint on localhost that calls `eval()` and returns JSON

Don't settle for "eval not available" — make the environment work for you.

#### 2.4 Test: What's the rebuild + restart cycle?

```
1. Make a code change (add a log statement)
2. Run the rebuild command
3. Verify rebuild completes successfully
4. Restart the runtime
5. Verify the change is now active (see the log)
```

✅ Document the exact commands for rebuild and restart
❌ If rebuild fails → fix build issues first

#### 2.5 Test: Can you send debug data out? (for sandboxed environments)

For environments where you can't access console (content scripts, web workers, etc.):

```
1. Set up a simple debug receiver (local server, endpoint)
2. Add a fetch/POST call in the sandboxed code
3. Trigger the code
4. Confirm you received the data
```

✅ If data arrives → document the debug server setup
❌ If blocked (CORS, CSP, etc.) → document the limitation and workarounds

#### 2.6 Test: Can you drive app state programmatically?

```
1. Write a script/command to reach a specific state
2. Run it
3. Confirm the app is in that state
```

✅ If it works → document the recipe
❌ If it fails → fix or note what's missing

#### 2.7 Test: Can you run automated tests?

```
1. Find existing test commands
2. Run them
3. Confirm they execute and report results
4. If no tests exist, note what testing infrastructure is available
```

✅ If tests run → document the commands
❌ If tests are broken → fix or document the issues

---

### Phase 3: Document verified methods in DEBUG.md

Only after completing Phase 2 verification for a runtime, add it to DEBUG.md.

Each entry must include:

-   What you tested
-   The exact command/code you used
-   What output you observed (proof it works)

Example format:

```markdown
## Runtime: content-script

### Logging (verified)

-   Method: fetch to local debug server
-   Tested: Added `fetch('http://localhost:3333/log', {method: 'POST', body: 'test'})` to content.ts
-   Result: Received "test" on debug server terminal
-   Command to start debug server: `npx http-echo-server 3333`

### Hot reload (verified)

-   Status: NOT available (requires extension reload)
-   Tested: Changed string in content.ts, change did not appear until manual reload
-   Reload method: Go to chrome://extensions, click reload button
```

---

## What to verify for each runtime

For every runtime you discover, you must test and document:

| Capability        | How to verify                      | What to document                |
| ----------------- | ---------------------------------- | ------------------------------- |
| **Start/Stop**    | Run command, check process/port    | Exact commands that work        |
| **Logging**       | Add log, trigger code, find output | Where logs appear, format       |
| **Hot reload**    | Change code, check if auto-updates | Yes/no, timing, trigger method  |
| **Debug output**  | For sandboxed envs: send data out  | Debug server setup, fetch calls |
| **State driving** | Script to reach specific state     | Commands/scripts that work      |
| **Testing**       | Run test suite                     | Commands, expected output       |

---

## Common techniques to try (and verify)

### Logging

-   `console.log` / `console.error` — works in Node, browser devtools
-   `process.stdout.write` — Node, visible in terminal
-   Fetch to debug server — for sandboxed environments (content scripts, workers)
-   File logging — when console not available

### Debug servers

-   Custom endpoint in your dev server
-   WebSocket for bidirectional communication

### Programmatic state

-   API calls with curl/fetch
-   Database seed scripts
-   Playwright/Puppeteer for UI automation
-   Deep links for mobile

---

## Anti-patterns (what NOT to do)

❌ Write "console.log should work here" without testing it
❌ Document a method you read about but didn't try
❌ Assume hot reload works without changing code and seeing the update
❌ Document a debug server setup without actually sending data to it
❌ Say "tests can be run with npm test" without running npm test

### CRITICAL: Reading code is NOT verification

**This is the most common mistake.** Reading source code to understand HOW something works is NOT the same as VERIFYING that it works.

❌ **NOT VERIFICATION:**

-   Reading `Logger.ts` and seeing it calls `console.log` → "logging works"
-   Reading `DebugEvalServer.ts` and seeing it listens on port 5656 → "debug server works"
-   Reading `launch.json` and seeing debug configurations → "debugging is set up"
-   Reading test files and seeing test cases → "tests work"

✅ **ACTUAL VERIFICATION:**

-   Adding `console.log('TEST123')` to a file, running the code, seeing "TEST123" in output
-   Running `curl -X POST http://localhost:5656/eval -d 'test'` and getting a response
-   Launching debugger, hitting a breakpoint, stepping through code
-   Running `pnpm test` and seeing test results in terminal

**The difference:** Reading code tells you what SHOULD happen. Running code tells you what ACTUALLY happens.

**Before writing "verified" in DEBUG.md, ask yourself:**

1. Did I execute a command and see output?
2. Did I modify code and observe the change?
3. Can I paste the exact terminal output that proves it works?

If you can't answer YES to at least one of these, you have NOT verified it.

---

## Success criteria

Your work on this skill is complete when DEBUG.md contains:

1. **Every runtime** in the repo is listed
2. For each runtime, **verified methods** for:
    - Starting and stopping
    - Observing output (logs, probes)
    - Iterating on changes (reload method)
    - Running tests
3. Each method includes **proof you tested it** (what you did, what you saw)
4. Any **limitations** are documented (e.g., "hot reload not available, requires manual restart")

---

## Maintenance

When you discover something new while working on other tasks:

-   New runtime? Add it to DEBUG.md after verification
-   Method stopped working? Update DEBUG.md
-   Found a better approach? Test it, then update

DEBUG.md is the source of truth for autonomous work. Keep it accurate.
