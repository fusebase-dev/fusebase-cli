import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { CONFIG_DIR, getUpdateChannel } from "../../config";
import { fetchManifest, compareVersions, type Manifest } from "../../remote-version";
import { VERSION } from "../../version";
import { logger } from "../../logger";

const CACHE_FILE = join(CONFIG_DIR, "update-cache.json");
const COMMENT_MAX_LINES = 8;
const REFRESH_PROBABILITY = 0.2; // refresh cache on ~20% of runs

interface UpdateCache {
  checkedAt: string;
  manifest: Manifest;
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(manifest: Manifest): void {
  logger.debug("Writing update cache with manifest: %j", manifest);
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const cache: UpdateCache = { checkedAt: new Date().toISOString(), manifest };
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    logger.warn("Failed to write update cache - ignoring write error: %j", err as Error);
    // Non-critical — ignore write errors
  }
}

function formatComment(comment: string): string {
  const lines = comment.trimEnd().split("\n");
  if (lines.length <= COMMENT_MAX_LINES) return lines.join("\n");
  return lines.slice(0, COMMENT_MAX_LINES).join("\n") + "\n...and more";
}

/**
 * Reads the local cache synchronously and prints an update notice if a newer
 * version is available. Refreshes the cache in the background on ~20% of runs
 * (always refreshes when no cache exists yet). Call this before program.parse()
 * so the notice is always printed first.
 */
export function checkForUpdates(): void {
  const cache = readCache();

  logger.debug('Check for updates - current version: %s, cache: %j', VERSION, cache);

  if (cache) {
    const channel = getUpdateChannel();
    const latestVersion = channel === "dev" && cache.manifest.devVersion
      ? cache.manifest.devVersion
      : cache.manifest.version;

    if (compareVersions(latestVersion, VERSION) > 0) {
      console.log(`New version of fusebase-cli found - ${latestVersion}!`);
      console.log("Run fusebase update to update.");
      if (cache.manifest.comment?.trim()) {
        console.log(formatComment(cache.manifest.comment));
      }
      console.log();
    }
  }

  // Refresh the cache in the background:
  // - always when no cache exists yet
  // - on a random 20% of runs otherwise
  const shouldRefresh = !cache || Math.random() < REFRESH_PROBABILITY;
  if (!shouldRefresh) return;

  fetchManifest()
    .then((manifest) => writeCache(manifest))
    .catch((err) => {
      logger.warn("Failed to fetch latest version info - ignoring: %j", err);
      // Ignore network errors during background check
    });
}
