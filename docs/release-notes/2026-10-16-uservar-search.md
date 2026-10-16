# Restricted uservar search (NIM-46090)

The opt-in `uservars-search` CLI flag includes the global uservar-search section
in the generated FuseBase Gate users guide. Without it, the operation name,
description and examples are absent from rendered project guidance.

The flag changes documentation only. Gate still requires a token explicitly
scoped to an organization listed in its server-side USERVARS_SEARCH_ALLOWED_ORG_IDS.
A local CLI flag cannot grant access. Distributed template source remains readable.

Verification: template rendering tested with the flag absent, enabled and with
an unrelated flag. Deploy the user-api-service and Gate changes before use.
