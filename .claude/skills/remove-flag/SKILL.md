---
name: remove-flag
description: Permanently remove a feature flag, enabling the gated feature forever. Use when asked to remove a flag, graduate a flag, or make a flagged feature always-on.
disable-model-invocation: true
argument-hint: <flag-name>
---

# Remove Feature Flag

Permanently enable a feature flag by removing all gating — the feature becomes always-on.

Flag to remove: $ARGUMENTS

## Steps

1. **Find all references** — search the entire codebase for the flag name (string literal, template variable, docs, etc.)

2. **`lib/config.ts`**:
   - Remove the flag from `KNOWN_FLAGS` array
   - Remove the flag from `KNOWN_FLAG_DESCRIPTIONS` object
   - Remove the flag from `ALWAYS_ON_FLAGS` array if present (leave the array intact with remaining entries)

3. **`index.ts`** — find any `if (hasFlag("<flag>"))` guards. Remove the conditional but **keep the guarded code** (e.g. `program.addCommand(...)` becomes unconditional). If `hasFlag` is no longer used anywhere in the file, remove its import.

4. **Template files in `project-template/`** — find `<% if (it.<flag>) { %>` and matching `<% } %>` blocks. Remove the Eta conditionals but **keep the content between them**. Be careful to match opening/closing pairs correctly — do not remove `<% } %>` that belongs to a different conditional.

5. **Documentation** — remove the flag row from the Experimental Flags table in `AGENTS.md` if present. Check `README.md` and `project-template/.claude/skills/fusebase-cli/SKILL.md` for any mention that the feature requires the flag.

6. **Verify** — run error checking on modified files. Confirm no remaining references to the flag as a feature flag (references to the feature itself, e.g. "cron jobs", are fine — only remove the flag gating).
