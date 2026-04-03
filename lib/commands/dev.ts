import { Command } from "commander";
import { access } from "fs/promises";
import { basename, join } from "path";
import { spawn, type ChildProcess } from "child_process";
import { openBrowser } from "./utils/open-browser";
import {
  attachBackendOutputLogging,
  attachFrontendDevServerOutputLogging,
  stopChildProcess,
  type ManagedFeatureDevProcess,
  type ManagedBackendDevProcess,
} from "../dev-server/backend-output";
import { select } from "@inquirer/prompts";
import { startDevServer, findAvailablePort } from "../dev-server/server";
import {
  createDevSessionLogPaths,
  redactSensitiveText,
  registerSensitiveValues,
  type DevSessionLogPaths,
} from "../dev-server/dev-debug-logs";
import {
  loadFuseConfig,
  getConfig,
  type FeatureConfig,
  type FuseConfig,
} from "../config";
import { detectDevServerUrl } from "../framework-detect";
import { fetchAppFeatureSecrets } from "../api";
import packageJson from "../../package.json";

const FUSE_JSON = "fusebase.json";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  cwd: string,
  label: string,
): Promise<void> {
  console.log(`   ${label}...`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error("\n\n", stdout, "\n");
        console.error("\n", stderr, "\n\n");
        reject(new Error(`${label} failed with exit code ${code}`));
      } else {
        resolve();
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to run command: ${error.message}`));
    });
  });
}

async function checkAndInstallDependencies(featurePath: string): Promise<void> {
  const packageJsonPath = join(featurePath, "package.json");

  if (await fileExists(packageJsonPath)) {
    await runCommand(
      "npm install --include=dev",
      featurePath,
      "Installing dependencies",
    );
  }
}

function findFeature(
  fuseConfig: FuseConfig,
  featureIdOrPath: string,
): FeatureConfig | undefined {
  return fuseConfig.features?.find(
    (f) =>
      f.id === featureIdOrPath ||
      f.path === featureIdOrPath ||
      basename(f.path || "") === featureIdOrPath,
  );
}

async function promptFeatureSelection(
  features: FeatureConfig[],
): Promise<FeatureConfig> {
  const result = await select({
    message: "Select a feature to develop:",
    choices: features.map((feature) => ({
      name: `${feature.path || feature.id}${feature.dev?.command ? "" : " (no dev command)"}`,
      value: feature,
    })),
  });
  return result;
}

export interface DevUrlState {
  url: string | null;
}

/**
 * Spawns feature frontend dev server process (Vite)
 */
async function spawnDevFeatureFrontend(
  feature: FeatureConfig,
  projectDir: string,
  devUrlState: DevUrlState,
  logPaths: DevSessionLogPaths,
  serverPort?: number,
  secretsEnv?: Record<string, string>,
): Promise<ManagedFeatureDevProcess | null> {
  if (!feature.dev?.command) {
    return null;
  }

  const featureDir = feature.path ? join(projectDir, feature.path) : projectDir;
  console.log(`\n🔧 Starting feature dev server: ${feature.dev.command}`);
  console.log(`   Working directory: ${featureDir}\n`);

  const devServerPort = await findAvailablePort(3000);

  console.log(`Dev server port: ${devServerPort}`);

  // On Windows, explicitly use PowerShell for better compatibility
  const isWindows = process.platform === "win32";
  if (isWindows) {
    console.log(
      "Running on windows, using cmd.exe to spawn the feature dev server",
    );
  }
  const child = spawn(feature.dev.command, [], {
    cwd: featureDir,
    shell: isWindows ? "cmd.exe" : true,
    stdio: ["inherit", "pipe", "pipe"],
    // Ensure proper environment inheritance on Windows
    env: {
      ...process.env,
      PORT: String(devServerPort),
      ...(serverPort !== undefined && { BACKEND_PORT: String(serverPort) }),
      ...secretsEnv,
    },
  });

  // Buffer to accumulate output for URL detection
  let outputBuffer = "";
  let urlDetected = false;

  const logs = attachFrontendDevServerOutputLogging(child, feature.id, logPaths.frontendDevServerPath, {
    onData(text) {
      if (!urlDetected) {
        outputBuffer += text;
        const detectedUrl = detectDevServerUrl(outputBuffer);
        if (detectedUrl) {
          urlDetected = true;
          devUrlState.url = detectedUrl;
          console.log(`\n✓ Detected dev server URL: ${detectedUrl}\n`);
        }
      }
    },
  });

  setTimeout(() => {
    if (!urlDetected) {
      // Set fallback URL immediately; URL detection can still override it
      devUrlState.url = `http://localhost:${devServerPort}`;
    }
  }, 2e3);

  if (!child.stdout) {
    console.warn(
      "Warning: Feature dev server has no stdout stream, dev server url detection may fail.",
    );
  }
  if (!child.stderr) {
    console.warn(
      "Warning: Feature dev server has no stderr stream, dev server url detection may fail.",
    );
  }

  return { child, logs };
}

/**
 * Spawns feature backend process (Hono) from the backend feature directory
 */
async function spawnDevFeatureBackend(
  feature: FeatureConfig,
  projectDir: string,
  backendPort: number,
  logPaths: DevSessionLogPaths,
  secretsEnv?: Record<string, string>,
): Promise<ManagedBackendDevProcess | null> {
  if (!feature.backend?.dev?.command) {
    return null;
  }

  const featureDir = feature.path ? join(projectDir, feature.path) : projectDir;
  const backendDir = join(featureDir, "backend");
  console.log(
    `\n🔧 Starting backend dev process: ${feature.backend.dev.command}`,
  );
  console.log(`   Working directory: ${backendDir}`);
  console.log(`   BACKEND_PORT: ${backendPort}\n`);

  const isWindows = process.platform === "win32";
  const child = spawn(feature.backend.dev.command, [], {
    cwd: backendDir,
    shell: isWindows ? "cmd.exe" : true,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, BACKEND_PORT: String(backendPort), ...secretsEnv },
  });
  const logs = attachBackendOutputLogging(child, feature.id, logPaths.backendOutputPath);

  child.on("error", (error) => {
    logs.append({
      timestamp: new Date().toISOString(),
      featureId: feature.id,
      line: redactSensitiveText(error.message),
    });
    console.error(`\nBackend dev process error: ${error.message}`);
  });

  return { child, logs };
}

export const devCommand = new Command("dev").description(
  "Development commands for Fusebase apps",
);

devCommand
  .command("start")
  .description("Start the development server for a feature")
  .argument("[feature]", "Feature ID or path (from fusebase.json features)")
  .action(async (featureIdOrPath?: string) => {
    // Print version
    console.log(`Fusebase CLI v${packageJson.version}\n`);

    const fuseJsonPath = join(process.cwd(), FUSE_JSON);

    // Check if app is initialized
    if (!(await fileExists(fuseJsonPath))) {
      console.error("Error: App not initialized. Run 'fusebase init' first.");
      process.exit(1);
    }

    // Load fusebase.json
    const fuseConfig = loadFuseConfig();
    if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.appId) {
      console.error("Error: Invalid fusebase.json. Missing orgId or appId.");
      process.exit(1);
    }

    // Check if there are any features configured
    if (!fuseConfig.features || fuseConfig.features.length === 0) {
      console.error("Error: No features configured in fusebase.json.");
      console.error("Add features to fusebase.json first.");
      process.exit(1);
    }

    // Load API key from config
    const config = getConfig();
    if (!config.apiKey) {
      console.error("Error: No API key configured. Run 'fusebase auth' first.");
      process.exit(1);
    }

    // Find or select the feature
    let selectedFeature: FeatureConfig | undefined;

    if (featureIdOrPath) {
      selectedFeature = findFeature(fuseConfig, featureIdOrPath);
      if (!selectedFeature) {
        console.error(
          `Error: Feature '${featureIdOrPath}' not found in fusebase.json.`,
        );
        console.error("Available features:");
        for (const f of fuseConfig.features) {
          console.error(`  - ${f.path || f.id} (id: ${f.id})`);
        }
        process.exit(1);
      }
    } else if (fuseConfig.features.length === 1) {
      // Auto-select if there's only one feature
      selectedFeature = fuseConfig.features[0];
    } else {
      selectedFeature = await promptFeatureSelection(fuseConfig.features);
    }

    if (!selectedFeature) {
      throw new Error("No feature selected.");
    }

    const projectDir = process.cwd();
    const featureDir = selectedFeature.path
      ? join(projectDir, selectedFeature.path)
      : projectDir;
    const logPaths = await createDevSessionLogPaths(featureDir);

    console.log(
      `\n✓ Selected feature: ${selectedFeature.path || selectedFeature.id}`,
    );
    console.log("Starting Fusebase dev server...\n");
    console.log(`🪵 Dev debug logs folder: ${logPaths.sessionDir}`);
    console.log(
      "   Files: browser-logs.jsonl, access-logs.jsonl, backend-logs.jsonl, frontend-dev-server-logs.jsonl\n",
    );

    // Check for package.json and run npm install if exists
    await checkAndInstallDependencies(featureDir);

    // Fetch feature secrets from backend and build env vars
    let secretsEnv: Record<string, string> = {};
    try {
      console.log("🔑 Fetching feature secrets...");
      const secretsResponse = await fetchAppFeatureSecrets(
        config.apiKey,
        fuseConfig.orgId,
        fuseConfig.appId,
        selectedFeature.id,
      );
      if (secretsResponse.secrets.length > 0) {
        registerSensitiveValues(
          secretsResponse.secrets.map((secret) => secret.value),
        );

        for (const secret of secretsResponse.secrets) {
          secretsEnv[secret.key] = secret.value;
        }
        console.log(
          `✓ Loaded ${secretsResponse.secrets.length} secret(s): ${secretsResponse.secrets.map((s) => s.key).join(", ")}`,
        );
      } else {
        console.log("   No secrets configured for this feature.");
      }
    } catch (error) {
      console.warn(
        `⚠️  Could not fetch feature secrets: ${error instanceof Error ? error.message : error}`,
      );
      console.warn("   Continuing without secrets.\n");
    }

    // Shared state for detected dev URL
    const devUrlState: DevUrlState = { url: null };

    // Allocate a backend port if the feature has a backend
    const backendPort = selectedFeature.backend?.dev?.command
      ? await findAvailablePort(3001)
      : undefined;

    // Start the backend dev process if configured
    let backendDevProcess: ManagedBackendDevProcess | null = null;
    if (backendPort !== undefined) {
      backendDevProcess = await spawnDevFeatureBackend(
        selectedFeature,
        projectDir,
        backendPort,
        logPaths,
        secretsEnv,
      );
    }

    // Start feature's own dev server if command is specified
    let featureDevProcess: ManagedFeatureDevProcess | null = null;
    if (selectedFeature.dev?.command) {
      featureDevProcess = await spawnDevFeatureFrontend(
        selectedFeature,
        projectDir,
        devUrlState,
        logPaths,
        backendPort,
        secretsEnv,
      );
    } else {
      console.log("⚠️  No dev.command specified for this feature.");
      console.log(
        "   You can enter the dev URL manually in the dev server UI.\n",
      );
    }

    // Start the dev server (API + static file serving)
    const devServer = await startDevServer(
      logPaths,
      4174,
      selectedFeature.id,
      devUrlState,
      backendPort,
    );

    // Open browser
    openBrowser(`http://localhost:${devServer.port}`);

    // Handle process termination
    const cleanup = async () => {
      console.log("\nShutting down dev server...");
      if (backendDevProcess) {
        await stopChildProcess(backendDevProcess.child);
        await backendDevProcess.logs.flush();
      }
      if (featureDevProcess) {
        await stopChildProcess(featureDevProcess.child);
        await featureDevProcess.logs.flush();
      }
      await devServer.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Keep the process running
    await new Promise(() => {});
  });
