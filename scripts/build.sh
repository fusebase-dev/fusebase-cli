#!/usr/bin/env bash
set -euo pipefail

# RELEASE_SCRIPTS must point to the fusebase-apps-cli-release-scripts directory.
# In CI it is set by the job's before_script. Locally, set it to your local clone.
if [[ -z "${RELEASE_SCRIPTS:-}" ]]; then
  echo "Error: RELEASE_SCRIPTS env var is not set (path to fusebase-apps-cli-release-scripts)"
  exit 1
fi

# PROJECT_ROOT is this repo's directory; default to cwd (where bun run build is called).
export PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
# For dev builds, generate a timestamp version (YYYY.mmddhh.mmss) and embed it
# as VERSION in the binary. Saved to build/.dev-version for the upload job.
# For prod builds (no DEV_VERSION env), VERSION comes from package.json.
if [[ -z "${DEV_VERSION:-}" && "${BUILD_CHANNEL:-}" == "dev" ]]; then
  export DEV_VERSION=$(date -u +"%Y.%m%d%H.%M%S")
fi

bun "$RELEASE_SCRIPTS/generate-version.ts"

if [[ "${UPLOAD_DEV:-}" == "1" ]]; then
  VERSION="$DEV_VERSION"
else
  VERSION=$(bun "$RELEASE_SCRIPTS/get-version.ts")
fi

rm -rf build
mkdir -p build

# Zip templates and assets
(cd project-template && zip -r ../project-template.zip .)
(cd feature-templates && zip -r ../feature-templates.zip .)
(cd ide-configs && zip -r ../ide-configs.zip .)
(cd managed-template && zip -r ../managed-template.zip .)
(cd dev-server && bun install && bun run vite build && cd dist && zip -r ../../dev-server-dist.zip .)

ASSETS=(./index.ts ./dev-server-dist.zip ./project-template.zip ./feature-templates.zip ./ide-configs.zip ./managed-template.zip)

bun build "${ASSETS[@]}" --compile --outfile "build/fusebase-${VERSION}-macos" --target=bun-darwin-arm64
bun build "${ASSETS[@]}" --compile --outfile "build/fusebase-${VERSION}-macos-x64" --target=bun-darwin-x64
bun build "${ASSETS[@]}" --compile --outfile "build/fusebase-${VERSION}" --target=bun-linux-x64
bun build "${ASSETS[@]}" --compile --outfile "build/fusebase-${VERSION}.exe" --target=bun-windows-x64

# Stable Windows launcher (fusebase.exe). Generate its auto-derived version
# first (from the launcher source's last git change): this writes the value as a
# baked literal into lib/launcher-version.ts (bun --compile does not bake
# build-time env) and prints it for the artifact name + manifest launcherVersion.
LAUNCHER_VERSION=$(bun "$PROJECT_ROOT/scripts/generate-launcher-version.ts")
bun build ./launcher/index.ts --compile --outfile "build/fusebase-launcher-${LAUNCHER_VERSION}.exe" --target=bun-windows-x64
echo "${LAUNCHER_VERSION}" > build/.launcher-version

# Embed the FuseBase icon and version metadata into the Windows binaries.
# `bun build --windows-icon` only works on Windows hosts; on Linux CI we use
# rcedit-x64.exe (via Wine, handled by the rcedit npm package) as a post-build
# step. Wine must be installed in the build environment.
bun "$PROJECT_ROOT/scripts/embed-windows-icon.ts" "build/fusebase-${VERSION}.exe" "${VERSION}"
bun "$PROJECT_ROOT/scripts/embed-windows-icon.ts" "build/fusebase-launcher-${LAUNCHER_VERSION}.exe" "${LAUNCHER_VERSION}"

rm dev-server-dist.zip project-template.zip feature-templates.zip ide-configs.zip managed-template.zip

# Save dev version for the upload job (empty file for prod builds)
echo "${DEV_VERSION:-}" > build/.dev-version
