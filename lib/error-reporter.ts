import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { CONFIG_DIR, CONFIG_FILE, getConfig, getEnv, loadFuseConfig } from "./config";
import { getCliErrorReportUploadUrls, submitCliErrorReport } from "./api";
import { VERSION } from "./version";
import { logger, loggerEvents } from "./logger";

interface CollectedError {
  message: string;
  stack?: string;
}

const collectedErrors: CollectedError[] = [];
let registered = false;
let flushing = false;

export function collectError(error: unknown): void {
  if (flushing) {
    logger.warn(
      "Error report is already flushing to the server, but received another flush request",
    );
    return;
  }
  if (error instanceof Error) {
    collectedErrors.push({ message: error.message, stack: error.stack });
  } else {
    collectedErrors.push({ message: String(error) });
  }
}

interface ReportFile {
  name: string;
  content: Buffer;
}

function collectReportFiles(): ReportFile[] {
  const files: ReportFile[] = [];

  const errorLogPath = join(CONFIG_DIR, "error.log");
  if (existsSync(errorLogPath)) {
    files.push({ name: "error.log", content: readFileSync(errorLogPath) });
  }

  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const config = JSON.parse(raw);
      delete config.apiKey;
      files.push({
        name: "config.json",
        content: Buffer.from(JSON.stringify(config, null, 2)),
      });
    } catch {
      // If we can't parse it, skip
    }
  }

  return files;
}

export async function flushReport(): Promise<void> {
  if (collectedErrors.length === 0) return;
  if (flushing) return;
  flushing = true;

  const config = getConfig();

  const fuseConfig = loadFuseConfig();
  const orgId = fuseConfig?.orgId || "unknown";

  const errorMessage = collectedErrors
    .map((e, i) =>
      collectedErrors.length === 1 ? e.message : `[${i + 1}] ${e.message}`,
    )
    .join("\n");

  const stackTrace = collectedErrors
    .filter((e) => e.stack)
    .map((e, i) => `--- Error ${i + 1} ---\n${e.stack}`)
    .join("\n\n");

  try {
    const reportFiles = collectReportFiles();

    let s3Path = "";
    if (reportFiles.length > 0) {
      const uploadUrlsRes = await getCliErrorReportUploadUrls(config.apiKey, {
        orgId,
        files: reportFiles.map((f) => f.name),
      });
      s3Path = uploadUrlsRes.s3Path;

      // Upload each file to S3 via presigned URLs
      await Promise.all(
        uploadUrlsRes.uploadUrls.map(async (urlEntry) => {
          const file = reportFiles.find((f) => f.name === urlEntry.path);
          if (!file) return;
          await fetch(urlEntry.uploadUrl, {
            method: "PUT",
            body: file.content,
          });
        }),
      );
    }
    await submitCliErrorReport(config.apiKey, orgId, {
      errorMessage,
      stackTrace: stackTrace || undefined,
      cliVersion: VERSION,
      appId: fuseConfig?.appId,
      env: getEnv(),
      command: process.argv.slice(2).join(" "),
      s3Path,
      metadata: { errorCount: collectedErrors.length },
    });
  } catch (err) {
    console.log(err);
    if (err instanceof Error) {
      logger.warn(
        "Failed to submit CLI error report to server %s",
        err.message,
      );
    }
  }
}

/**
 * Catch errors from logger and uncaught exceptions/unhandled rejections,
 * then flush them to the server on process exit.
 * @returns
 */
export function registerErrorReporter(): void {
  if (registered) return;
  registered = true;

  loggerEvents.on("log-error", (logEntry) => {
    if (logEntry.message) {
      collectedErrors.push({
        message: JSON.stringify(logEntry.message),
        stack: logEntry.stack,
      });
    }
  });

  process.on("uncaughtException", (err) => {
    logger.error({ msg: "Uncaught exception", err });
    collectError(err);
    // Uncaught exceptions leave the process in an undefined state, so we must
    // terminate explicitly after flushing. Unlike unhandledRejection (where the
    // event loop keeps running and process.exit elsewhere will trigger the flush),
    // an uncaughtException handler prevents the default crash — if we don't call
    // originalExit the process may hang or continue in a broken state.
    flushReport().finally(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ msg: "Unhandled rejection", reason });
    collectError(reason);
  });

  // Flush report when the event loop drains naturally (e.g. command finishes
  // without calling process.exit). The async flushReport keeps the loop alive
  // long enough to complete the HTTP request.
  process.on("beforeExit", () => {
    if (collectedErrors.length > 0) {
      flushReport();
    }
  });
}
