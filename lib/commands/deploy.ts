import { Command } from "commander";
import { readFile, readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { homedir } from "os";
import mime from "mime";
import cliProgress from "cli-progress";
import { spawn } from "child_process";
import * as tar from "tar";
import {
  createAppFeatureVersion,
  initUpload,
  initSourceUpload,
  getActiveVersion,
  createDeploy,
  getDeploy,
  fetchApp,
  fetchAppFeatures,
  copyBackendParams,
  copyFrontendParams,
  type App,
  type AppFeature,
  type Deploy,
  type DeployJobDefinition,
  type DeploySidecarDefinition,
} from "../api";
import { getFusebaseAppHost } from "../config";
import { logger } from "../logger";
import {
  getConfig,
  loadFuseConfig,
  type FeatureConfig,
  type SidecarConfig,
} from "../config";

const FUSE_JSON = "fusebase.json";
const UPLOAD_CONCURRENCY = 5;
const DEPLOY_POLL_INTERVAL_MS = 3000;

async function getAllFiles(
  dir: string,
  baseDir: string = dir,
  exclude: string[] = [],
): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (dir === baseDir && exclude.includes(entry.name)) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      // Return relative path from base directory
      files.push(
        relative(baseDir, fullPath)
          // replace \ in path to / for windows compatibility
          .replace("\\", "/"),
      );
    }
  }

  return files;
}

async function uploadFile(
  uploadUrl: string,
  filePath: string,
  featureDir: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const fullPath = join(featureDir, filePath);
  const fileContent = await readFile(fullPath);
  const fileStats = await stat(fullPath);

  // Determine content type based on file extension
  const contentType = mime.getType(filePath) || "application/octet-stream";

  logger.info("Uploading file %s to %s", filePath, uploadUrl);

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Content-Length": fileStats.size.toString(),
    },
    body: fileContent,
  });

  if (!response.ok) {
    logger.error(
      `Upload failed for ${filePath} to ${uploadUrl}: ${response.status} ${response.statusText}`,
    );
    throw new Error(
      `Failed to upload ${filePath}: ${response.status} ${response.statusText}`,
    );
  }

  if (onProgress) {
    onProgress(fileStats.size, fileStats.size);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

async function runCommand(
  command: string,
  cwd: string,
  label: string,
): Promise<void> {
  console.log(`   ${label}...`);
  logger.debug("Running command: %s in %s", command, cwd);

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
        logger.error("Command failed with code %d", code ?? -1);
        if (stdout) logger.debug("stdout: %s", stdout);
        if (stderr) logger.error("stderr: %s", stderr);

        console.error("\n\n", stdout, "\n");
        console.error("\n", stderr, "\n\n");

        reject(new Error(`${label} failed with exit code ${code}`));
      } else {
        logger.debug("Command completed successfully");
        if (stdout) logger.debug("stdout: %s", stdout);
        resolve();
      }
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to run command: ${error.message}`));
    });
  });
}

/**
 * Calculate a deterministic SHA-256 hash of all files in a directory.
 * Files are sorted by path to ensure consistent ordering.
 * Excludes node_modules and hidden files.
 */
async function calculateBackendHash(dir: string): Promise<string> {
  const { createHash } = await import("crypto");
  const files = await getAllFiles(dir, dir, ["node_modules"]);
  files.sort();

  const hash = createHash("sha256");
  for (const file of files) {
    // Include the file path in the hash to detect renames
    hash.update(file);
    const content = await readFile(join(dir, file));
    hash.update(content);
  }
  return hash.digest("hex");
}

async function calculateFrontendHash(
  dir: string,
  exclude: string[] = [],
): Promise<string> {
  const { createHash } = await import("crypto");
  const files = await getAllFiles(dir, dir, ["node_modules", ...exclude]);
  files.sort();

  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    const content = await readFile(join(dir, file));
    hash.update(content);
  }
  return hash.digest("hex");
}

/**
 * Create a tar.gz archive of the given directory and return its path.
 * Uses the `tar` npm package (pure JS, no system tar dependency).
 */
async function createSourceArchive(
  sourceDir: string,
  exclude: string[] = [],
): Promise<string> {
  const archivePath = join(sourceDir, ".source.tar.gz");

  // Get all entries at the top level of sourceDir (excluding the archive itself and hidden files)
  const entries = await readdir(sourceDir);
  const filtered = entries.filter(
    (e) => e !== ".source.tar.gz" && !e.startsWith(".") && !exclude.includes(e),
  );

  if (filtered.length === 0) {
    throw new Error("No source files found to archive");
  }

  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: sourceDir,
    },
    filtered,
  );

  return archivePath;
}

/**
 * Poll the deploy endpoint until it reaches a terminal status.
 * Streams new log lines to the console as they arrive.
 */
async function pollDeployStatus(
  apiKey: string,
  orgId: string,
  deployId: string,
): Promise<Deploy> {
  let printedLogLength = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const deploy = await getDeploy(apiKey, orgId, deployId);

    // Print any new log output
    if (deploy.log && deploy.log.length > printedLogLength) {
      const newContent = deploy.log.slice(printedLogLength);
      process.stdout.write(newContent);
      printedLogLength = deploy.log.length;
    }

    if (deploy.status === "finished" || deploy.status === "failed") {
      return deploy;
    }

    await new Promise((r) => setTimeout(r, DEPLOY_POLL_INTERVAL_MS));
  }
}

async function checkAndInstallDependencies(featurePath: string): Promise<void> {
  const packageJsonPath = join(featurePath, "package.json");

  try {
    await stat(packageJsonPath);
    // package.json exists, run npm install with --include=dev to ensure devDependencies are installed
    await runCommand(
      "npm install --include=dev",
      featurePath,
      "Installing dependencies",
    );
  } catch {
    // package.json doesn't exist, skip npm install
    logger.debug(
      "No package.json found in %s, skipping npm install",
      featurePath,
    );
  }
}

async function runLintIfPresent(featurePath: string): Promise<void> {
  const packageJsonPath = join(featurePath, "package.json");
  try {
    const raw = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: { lint?: string } };
    if (pkg.scripts?.lint) {
      await runCommand("npm run lint", featurePath, "Linting");
    }
  } catch {
    // No package.json or no lint script — skip
    logger.debug("No lint script in %s, skipping lint", featurePath);
  }
}

async function runBuildCommand(featureConfig: FeatureConfig): Promise<void> {
  const buildCommand = featureConfig.build?.command;
  if (!buildCommand) {
    return;
  }

  const featurePath = featureConfig.path
    ? join(process.cwd(), featureConfig.path)
    : process.cwd();

  // Dependencies are already installed by the deploy loop before lint
  await runCommand(buildCommand, featurePath, "Building");
}

export const deployCommand = new Command("deploy")
  .description("Deploy features to Fusebase")
  .option(
    "--force",
    "Force re-upload and re-deploy regardless of frontend/backend hash match",
  )
  .action(async (opts: { force?: boolean }) => {
    const force = opts.force ?? false;
    // Check if app is initialized
    const fuseConfig = await loadFuseConfig();
    if (!fuseConfig) {
      console.error("Error: App not initialized. Run 'fusebase init' first.");
      process.exit(1);
    }

    if (!fuseConfig.orgId || !fuseConfig.appId) {
      console.error("Error: Invalid fusebase.json. Missing orgId or appId.");
      process.exit(1);
    }

    // Load API key from config
    const config = await getConfig();
    if (!config.apiKey) {
      console.error("Error: No API key configured. Run 'fusebase auth' first.");
      process.exit(1);
    }

    // Find features with path configured
    const featuresConfig = fuseConfig.features || [];
    const deployableFeatures = featuresConfig.filter(
      (config) => config.path && config.path.trim() !== "",
    );

    if (deployableFeatures.length === 0) {
      console.error(
        "Error: No features with path configured in fusebase.json.",
      );
      console.error(
        "Use 'fusebase feature create' to configure a path for deployment.",
      );
      process.exit(1);
    }

    console.log(`\nDeploying ${deployableFeatures.length} feature(s)...\n`);

    // Fetch app and features to get sub and path for URLs
    let app: App;
    let features: AppFeature[];
    try {
      app = await fetchApp(config.apiKey, fuseConfig.orgId, fuseConfig.appId);
      const featuresResponse = await fetchAppFeatures(
        config.apiKey,
        fuseConfig.orgId,
        fuseConfig.appId,
      );
      features = featuresResponse.features;
    } catch (error) {
      console.error("Error: Failed to fetch app or features from API.");
      process.exit(1);
    }

    logger.debug("Fetched app: %j", app);

    // Determine domain based on environment (same as FUSEBASE_APP_HOST)
    const domain = getFusebaseAppHost();

    const results: Array<{
      featureId: string;
      versionId: string;
      url: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }> = [];

    for (const featureConfig of deployableFeatures) {
      const featureId = featureConfig.id;
      const featureBasePath = join(process.cwd(), featureConfig.path!);

      console.log(`📦 Feature: ${featureId}`);
      console.log(`   Source: ${featureConfig.path}`);

      try {
        // Check if base path exists
        try {
          await stat(featureBasePath);
        } catch {
          throw new Error(`path does not exist: ${featureConfig.path}`);
        }

        // Install dependencies so lint and build have devDependencies (e.g. eslint)
        await checkAndInstallDependencies(featureBasePath);

        // Run lint if feature has a lint script (e.g. in package.json)
        await runLintIfPresent(featureBasePath);

        // Run build command if specified
        if (featureConfig.build?.command) {
          await runBuildCommand(featureConfig);
        }

        // ── Detect backend folder for hybrid (static + backend) deploy ──────
        const backendDir = join(featureBasePath, "backend");
        let hasBackendDir = false;
        try {
          const backendDirStat = await stat(backendDir);
          hasBackendDir = backendDirStat.isDirectory();
        } catch {
          // no backend folder
        }

        // ── Resolve upload directory and listing ────────────────────────────
        const uploadDir = featureConfig.build?.outputDir
          ? join(featureBasePath, featureConfig.build.outputDir)
          : featureBasePath;

        try {
          await stat(uploadDir);
        } catch {
          const outputDirPath = featureConfig.build?.outputDir
            ? `${featureConfig.path}/${featureConfig.build.outputDir}`
            : featureConfig.path;
          throw new Error(`output directory does not exist: ${outputDirPath}`);
        }

        // Exclude backend folder from static upload/hash when it lives in uploadDir
        const staticExclude =
          hasBackendDir && !featureConfig.build?.outputDir ? ["backend"] : [];

        const files = await getAllFiles(uploadDir, uploadDir, staticExclude);
        if (files.length === 0) {
          const outputDirPath = featureConfig.build?.outputDir
            ? `${featureConfig.path}/${featureConfig.build.outputDir}`
            : featureConfig.path;
          throw new Error(`No files found in: ${outputDirPath}`);
        }

        if (featureConfig.build?.outputDir) {
          console.log(`   Output: ${featureConfig.build.outputDir}`);
        }
        console.log(`   Files: ${files.length}`);

        // ── Compute hashes upfront so skip decisions are made before any upload ──
        console.log(`   Calculating frontend hash...`);
        const frontendHash = await calculateFrontendHash(
          uploadDir,
          staticExclude,
        );
        logger.info("Frontend hash: %s", frontendHash);

        let backendHash: string | undefined;
        if (hasBackendDir) {
          console.log(`   Calculating backend hash...`);
          backendHash = await calculateBackendHash(backendDir);
          logger.info("Backend hash: %s", backendHash);
        }

        // Fetch active version BEFORE creating a new one so we can decide which
        // of the four branches to take (force / skip-all / frontend-copy / full)
        const activeVersion = await getActiveVersion(
          config.apiKey,
          fuseConfig.orgId,
          fuseConfig.appId,
          featureId,
        ).catch(() => null);

        const frontendMatches =
          !!activeVersion?.frontendHash &&
          activeVersion.frontendHash === frontendHash;
        const backendMatches = hasBackendDir
          ? !!activeVersion?.backendHash &&
            activeVersion.backendHash === backendHash
          : true;

        // ── Branch B: skip the whole feature (no version, no upload, no deploy) ─
        if (!force && frontendMatches && backendMatches) {
          console.log(
            `   ✓ No changes for feature, skipping deploy\n`,
          );

          const feature = features.find((f) => f.id === featureId);
          const featureUrl = feature?.sub
            ? `https://${feature.sub}.${domain}/`
            : "";

          results.push({
            featureId,
            versionId: activeVersion?.globalId ?? "",
            url: featureUrl,
            success: true,
            skipped: true,
          });
          continue;
        }

        // Create a new version (branches A, C, D)
        console.log(`   Creating version...`);
        const version = await createAppFeatureVersion(
          config.apiKey,
          fuseConfig.orgId,
          fuseConfig.appId,
          featureId,
        );

        // ── Frontend handling ───────────────────────────────────────────────
        if (!force && frontendMatches && activeVersion?.globalId) {
          // Branch C: frontend unchanged — reuse s3Path/frontendHash via copyFrontendParams
          console.log(
            `   ✓ Frontend unchanged (hash matches active version), skipping upload`,
          );
          await copyFrontendParams(
            config.apiKey,
            fuseConfig.orgId,
            version.id,
            activeVersion.globalId,
          );
        } else {
          // Branches A, D: upload frontend
          console.log(`   Initializing upload...`);
          const uploadResponse = await initUpload(
            config.apiKey,
            fuseConfig.orgId,
            fuseConfig.appId,
            featureId,
            version.id,
            files,
            frontendHash,
          );

          const totalFiles = uploadResponse.uploads.length;
          let uploadedFiles = 0;
          let totalBytes = 0;
          let uploadedBytes = 0;

          for (const file of files) {
            const filePath = join(uploadDir, file);
            const fileStats = await stat(filePath);
            totalBytes += fileStats.size;
          }

          console.log(
            `   Uploading ${totalFiles} files (${formatBytes(totalBytes)})...`,
          );

          const progressBar = new cliProgress.SingleBar({
            format:
              "   {bar} {percentage}% | {value}/{total} bytes | {files}/{totalFiles} files",
            barCompleteChar: "█",
            barIncompleteChar: "░",
            hideCursor: true,
          });
          progressBar.start(totalBytes, 0, { files: 0, totalFiles });

          for (
            let i = 0;
            i < uploadResponse.uploads.length;
            i += UPLOAD_CONCURRENCY
          ) {
            const chunk = uploadResponse.uploads.slice(
              i,
              i + UPLOAD_CONCURRENCY,
            );

            await Promise.all(
              chunk.map(async (upload) => {
                const filePath = join(uploadDir, upload.path);
                const fileStats = await stat(filePath);

                await uploadFile(upload.uploadUrl, upload.path, uploadDir);

                uploadedFiles++;
                uploadedBytes += fileStats.size;

                progressBar.update(uploadedBytes, {
                  files: uploadedFiles,
                  totalFiles,
                });
              }),
            );
          }

          progressBar.stop();
          console.log(`   ✓ Static files deployed successfully\n`);
        }

        // ── Backend deploy flow (if backend folder present) ──────────────────
        if (hasBackendDir && backendHash) {
          console.log(`   Deploying backend...`);

          if (!force && backendMatches && activeVersion?.globalId) {
            console.log(
              `   ✓ Backend unchanged (hash matches active version), skipping deploy\n`,
            );
            // Copy backend params from the active version to the new version
            await copyBackendParams(
              config.apiKey,
              fuseConfig.orgId,
              version.id,
              activeVersion.globalId,
            );
          } else {
            console.log(
              "   Backend hash does not match active version, proceeding with deploy (local ",
              backendHash,
              " != remote",
              activeVersion?.backendHash,
              ")",
            );
            // Create tar.gz of backend folder
            console.log(`   Archiving backend...`);
            const archivePath = await createSourceArchive(backendDir, [
              "node_modules",
            ]);
            const archiveStats = await stat(archivePath);
            console.log(`   Archive: ${formatBytes(archiveStats.size)}`);

            // Get presigned upload URL
            console.log(`   Requesting backend upload URL...`);
            const { uploadUrl: serverUploadUrl } = await initSourceUpload(
              config.apiKey,
              fuseConfig.orgId,
              fuseConfig.appId,
              featureId,
              version.id,
              backendHash,
            );

            // Upload archive to S3
            console.log(`   Uploading backend archive...`);
            const archiveContent = await readFile(archivePath);
            const serverUploadRes = await fetch(serverUploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": "application/gzip",
                "Content-Length": archiveStats.size.toString(),
              },
              body: archiveContent,
            });
            if (!serverUploadRes.ok) {
              logger.error(
                "Fail to upload backend archive to url %s: %d %s, %s",
                serverUploadUrl,
                serverUploadRes.status,
                serverUploadRes.statusText,
                await serverUploadRes.text(),
              );
              throw new Error(
                `Backend upload failed: ${serverUploadRes.status} ${serverUploadRes.statusText}`,
              );
            }

            // Clean up temp archive
            const { unlink } = await import("fs/promises");
            await unlink(archivePath).catch(() => {});

            // Transform sidecar config for API (env Record -> key/value array)
            const toDeploySidecars = (
              list: SidecarConfig[] | undefined,
            ): DeploySidecarDefinition[] | undefined =>
              list?.map((sc) => ({
                name: sc.name,
                image: sc.image,
                ...(sc.port != null ? { port: sc.port } : {}),
                ...(sc.env
                  ? {
                      env: Object.entries(sc.env).map(([key, value]) => ({
                        key,
                        value,
                      })),
                    }
                  : {}),
                ...(sc.tier ? { tier: sc.tier } : {}),
              }));

            const sidecars = toDeploySidecars(featureConfig.backend?.sidecars);

            if (sidecars && sidecars.length > 0) {
              console.log(
                `   Sidecars: ${sidecars.map((s) => s.name).join(", ")}`,
              );
            }

            const jobs: DeployJobDefinition[] | undefined =
              featureConfig.backend?.jobs?.map((j) => {
                const jobSidecars = toDeploySidecars(j.sidecars);
                return {
                  name: j.name,
                  type: j.type,
                  cron: j.cron,
                  command: j.command,
                  ...(jobSidecars && jobSidecars.length > 0
                    ? { sidecars: jobSidecars }
                    : {}),
                };
              });

            if (jobs) {
              for (const j of jobs) {
                if (j.sidecars && j.sidecars.length > 0) {
                  console.log(
                    `   Job ${j.name} sidecars: ${j.sidecars
                      .map((s) => s.name)
                      .join(", ")}`,
                  );
                }
              }
            }

            // Start backend deploy
            console.log(`   Starting backend deploy...`);
            const deploy = await createDeploy(
              config.apiKey,
              fuseConfig.orgId,
              fuseConfig.appId,
              featureId,
              version.id,
              jobs,
              sidecars,
            );
            console.log(`   Deploy ID: ${deploy.id}`);
            console.log(`   Waiting for backend deploy to complete...\n`);

            // Poll deploy status & stream logs
            const finalDeploy = await pollDeployStatus(
              config.apiKey,
              fuseConfig.orgId,
              deploy.id,
            );

            if (finalDeploy.status === "failed") {
              throw new Error("Backend deploy failed — see logs above");
            }

            console.log(`\n   ✓ Backend deployed successfully\n`);
          } // end else (hash changed)
        }

        // Build feature URL
        const feature = features.find((f) => f.id === featureId);
        logger.debug("Feature info: %j", feature || {});
        const featureUrl = feature?.sub
          ? `https://${feature.sub}.${domain}/`
          : "";

        results.push({
          featureId,
          versionId: version.id,
          url: featureUrl,
          success: true,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.log(`   ✗ Failed: ${errorMessage}\n`);
        results.push({
          featureId,
          versionId: "",
          url: "",
          success: false,
          error: errorMessage,
        });
      }
    }

    // Summary
    console.log("═".repeat(50));
    console.log("Deployment Summary\n");

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (successful.length > 0) {
      console.log("✓ Successful deployments:");
      for (const result of successful) {
        const tag = result.skipped ? " (skipped — no changes)" : "";
        console.log(`  • ${result.featureId}${tag}`);
        if (result.versionId) {
          console.log(`    Version ID: ${result.versionId}`);
        }
        if (result.url) {
          console.log(`    URL: ${result.url}`);
        }
      }
    }

    if (failed.length > 0) {
      console.log("\n✗ Failed deployments:");
      for (const result of failed) {
        console.log(`  • ${result.featureId}: ${result.error}`);
      }
    }

    console.log(
      `\nTotal: ${successful.length} succeeded, ${failed.length} failed`,
    );

    if (failed.length > 0) {
      process.exit(1);
    }
  });
