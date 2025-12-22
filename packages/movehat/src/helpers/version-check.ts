import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { isNewerVersion } from "./semver-utils.js";

interface VersionCache {
  lastChecked: number;
  latestVersion: string;
}

interface NpmRegistryResponse {
  "dist-tags": {
    latest: string;
  };
}

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const CACHE_DIR = join(homedir(), ".movehat");
const CACHE_FILE = join(CACHE_DIR, "version-cache.json");

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

    const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as NpmRegistryResponse;
    return data["dist-tags"].latest;
  } catch (error) {
    // Silently fail - don't interrupt user's workflow
    return null;
  }
}

/**
 * Read version from cache
 */
function readCache(): VersionCache | null {
  try {
    if (!existsSync(CACHE_FILE)) {
      return null;
    }

    const cacheContent = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(cacheContent) as VersionCache;
  } catch (error) {
    return null;
  }
}

/**
 * Write version to cache
 */
function writeCache(latestVersion: string): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cache: VersionCache = {
      lastChecked: Date.now(),
      latestVersion,
    };

    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    // Silently fail - don't interrupt user's workflow
  }
}

/**
 * Check if a newer version is available and notify the user
 * This runs synchronously using cache, and updates cache in background
 */
export function checkForUpdates(currentVersion: string, packageName: string): void {
  try {
    const cache = readCache();
    let shouldNotify = false;

    // Check cache synchronously for immediate notification
    if (cache && isNewerVersion(currentVersion, cache.latestVersion)) {
      shouldNotify = true;
    }

    // Display notification immediately if cache says there's an update
    if (shouldNotify && cache) {
      const updateMessage =
        "\n" +
        "┌" + "─".repeat(60) + "┐\n" +
        `│  Update available: ${currentVersion} → ${cache.latestVersion}`.padEnd(61) + "│\n" +
        `│  Run: movehat update`.padEnd(61) + "│\n" +
        "└" + "─".repeat(60) + "┘\n";

      console.error(updateMessage);
    }

    // Update cache in background if needed (doesn't block)
    if (!cache || Date.now() - cache.lastChecked > CACHE_DURATION) {
      setImmediate(async () => {
        try {
          const latestVersion = await fetchLatestVersion(packageName);
          if (latestVersion) {
            writeCache(latestVersion);
          }
        } catch (error) {
          // Silently fail
        }
      });
    }
  } catch (error) {
    // Silently fail - never interrupt user's workflow
  }
}
