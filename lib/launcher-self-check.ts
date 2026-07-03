import { compareVersions } from "./remote-version";

export interface LauncherGateInput {
  platform: NodeJS.Platform;
  /** True when running from source / `bun link` (dev mode) — never gated. */
  localLinked: boolean;
  /** `process.env.FUSEBASE_LAUNCHER_VERSION` (absent ⇒ not launched by a launcher). */
  launcherVersionEnv: string | undefined;
  /** Baked `REQUIRED_LAUNCHER`. */
  required: string;
  /** `process.argv.slice(2)`. */
  argv: string[];
}

export interface LauncherGateResult {
  block: boolean;
  message?: string;
}

const BLOCK_MESSAGE =
  "Your launcher is too old for this CLI version. Run `fusebase update --launcher`.\n" +
  "If you can't update right now, run the command with `--previous-version`, but updating as soon as possible is highly recommended.";

/**
 * Remediation/info commands that must keep working while the gate blocks:
 * a bare invocation (shows help), `update --launcher`, the `version` subcommand,
 * `--version`/`-V`, `--help`/`-h`.
 */
function isAllowlisted(argv: string[]): boolean {
  if (argv.length === 0) return true;
  if (argv[0] === "version") return true;
  if (argv.includes("--version") || argv.includes("-V")) return true;
  if (argv.includes("--help") || argv.includes("-h")) return true;
  if (argv[0] === "update" && argv.includes("--launcher")) return true;
  return false;
}

/**
 * Hard gate: on Windows (non-dev), block every non-allowlisted command when the
 * launcher is absent or older than the CLI build's baked `REQUIRED_LAUNCHER`.
 * Pure — all inputs injected — so it runs under `bun test` on any platform.
 */
export function evaluateLauncherGate(
  input: LauncherGateInput,
): LauncherGateResult {
  if (input.platform !== "win32") return { block: false };
  if (input.localLinked) return { block: false };
  if (isAllowlisted(input.argv)) return { block: false };

  const tooOld =
    !input.launcherVersionEnv ||
    compareVersions(input.launcherVersionEnv, input.required) < 0;

  return tooOld ? { block: true, message: BLOCK_MESSAGE } : { block: false };
}
