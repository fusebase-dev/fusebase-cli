/**
 * Formats `--version` / `version` output. When launched by a launcher
 * (`FUSEBASE_LAUNCHER_VERSION` present, Windows) it shows both versions and the
 * channel; otherwise it prints the CLI version only (current behavior).
 */
export function formatVersionInfo(params: {
  cliVersion: string;
  launcherVersion: string | undefined;
  channel: "prod" | "dev";
}): string {
  if (!params.launcherVersion) return params.cliVersion;
  return [
    `FuseBase CLI ${params.cliVersion}`,
    `Launcher ${params.launcherVersion}`,
    `Channel ${params.channel}`,
  ].join("\n");
}
