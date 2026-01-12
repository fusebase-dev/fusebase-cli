# managed-template

Content used only when the app is initialized with **`fusebase init --managed`**. Not part of the default project-template, so it is never copied for users who init without `--managed`.

- **AGENTS.managed.md** — Fragment appended to `AGENTS.md` when `--managed` is used (aliases, resolveAliases, no hardcoded dashboard IDs).

To add more managed-only assets: put files here and include them in `scripts-release/build.sh` ASSETS so they are embedded in the CLI binary.
