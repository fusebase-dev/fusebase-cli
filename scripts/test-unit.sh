#!/usr/bin/env bash
# Unit suite, one bun process per file.
#
# `bun test test/*.test.ts` runs every file in a single process, so anything a
# file leaves behind is inherited by the ones after it. test/app-update-gate-
# permissions.test.ts calls mock.module("../lib/config.ts"), which bun applies
# to the whole process and never undoes: from that point on the real
# writeBackendOnlyGatePermissionsToFusebaseJson is a no-op and loadFuseConfig
# returns a fixture. On a developer machine the suite happened to survive it;
# in the CI image it cost 35 failures (NIM-44275). The suite also carries a
# fuse config cache, a process env override and a process cwd across files.
set -uo pipefail

failed=()
for file in test/*.test.ts; do
  bun test "$file" --timeout 30000 || failed+=("$file")
done

if [ ${#failed[@]} -gt 0 ]; then
  echo
  echo "Failed test files (${#failed[@]}):"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
