---
name: git-debug-commits
description: "Use when debugging and fixing generated app issues. After each verified fix, create a dedicated git commit and include commit SHA in the debug report so the user can roll back safely."
---

# Git Debug Commits

## Purpose

When you debug and fix issues in a generated app, create a dedicated Git commit for each verified fix so the user can revert quickly if needed.

This skill is intended for iterative debugging sessions where traceability and rollback safety are important.

## When To Use

Use this skill when:

- You are fixing runtime or build issues in a generated app.
- The user asks for debugging with safe rollback points.
- You are producing a debug report and need to reference exact fix commits.

Do not use this skill for purely exploratory analysis with no code changes.

## Workflow

1. Reproduce the issue.
2. Implement a focused fix.
3. Verify the fix (run the relevant command/test).
4. Create a dedicated commit for that fix.
5. Add the commit SHA to the debug report.

Keep each commit scoped to one concrete fix whenever possible.

## Commit Rules

- Commit message should explain why the fix was needed.
- Avoid bundling multiple unrelated fixes into one commit.
- Do not commit secrets or credential files.
- Do not force push or rewrite history during debug flow.

Recommended message format:

`fix(debug): <short reason-focused description>`

## Debug Report Requirements

For each fixed issue, include:

- Issue summary
- Verification performed
- Commit SHA
- Safe rollback command

Use this rollback recommendation:

`git revert <commit_sha>`

For local-only temporary rollback during active debugging, you may mention:

`git reset --hard <commit_sha_before_fix>`

Prefer `git revert` in shared branches because it preserves history.
