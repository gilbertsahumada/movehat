import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageJson {
  name: string;
  version: string;
}

interface NpmRegistryResponse {
  "dist-tags": {
    latest: string;
  };
}

/**
 * Compare two semver versions
 * Returns true if newVersion > currentVersion
 */
function isNewerVersion(currentVersion: string, newVersion: string): boolean {
  // Remove any pre-release tags (e.g., -alpha.0, -beta.1)
  const cleanCurrent = currentVersion.split("-")[0];
  const cleanNew = newVersion.split("-")[0];

  const current = cleanCurrent.split(".").map(Number);
  const newer = cleanNew.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (newer[i] > current[i]) return true;
    if (newer[i] < current[i]) return false;
  }

  // If base versions are equal, check pre-release tags
  // A version with no pre-release tag is considered newer than one with a tag
  const currentHasPrerelease = currentVersion.includes("-");
  const newHasPrerelease = newVersion.includes("-");

  if (!currentHasPrerelease && newHasPrerelease) {
    return false; // Current stable is newer than new pre-release
  }

  if (currentHasPrerelease && !newHasPrerelease) {
    return true; // New stable is newer than current pre-release
  }

  return false;
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(packageName: string): Promise<string> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch package info: ${response.statusText}`);
    }

    const data = (await response.json()) as NpmRegistryResponse;
    return data["dist-tags"].latest;
  } catch (error) {
    throw new Error(
      `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Detect which package manager was used to install movehat
 */
function detectPackageManager(): "yarn" | "npm" | "pnpm" {
  // Check for yarn.lock, package-lock.json, or pnpm-lock.yaml in parent directories
  // For global installs, default to yarn as per user preference
  return "yarn";
}

/**
 * Update command - checks for updates and installs the latest version
 */
export default async function updateCommand() {
  try {
    console.log("Checking for updates...\n");

    // Read current version from package.json
    const packageJsonPath = join(__dirname, "../../package.json");
    const packageJson: PackageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf-8")
    );

    const currentVersion = packageJson.version;
    const packageName = packageJson.name;

    console.log(`Current version: ${currentVersion}`);

    // Fetch latest version from npm
    const latestVersion = await fetchLatestVersion(packageName);
    console.log(`Latest version:  ${latestVersion}\n`);

    // Compare versions
    if (!isNewerVersion(currentVersion, latestVersion)) {
      console.log("✓ You are already using the latest version!");
      return;
    }

    console.log(`New version available: ${currentVersion} -> ${latestVersion}`);
    console.log("\nUpdating movehat...\n");

    // Detect package manager
    const packageManager = detectPackageManager();

    // Build update command based on package manager
    let updateArgs: string[];
    switch (packageManager) {
      case "yarn":
        updateArgs = ["global", "upgrade", packageName];
        break;
      case "pnpm":
        updateArgs = ["add", "-g", `${packageName}@latest`];
        break;
      case "npm":
      default:
        updateArgs = ["update", "-g", packageName];
        break;
    }

    // Execute update
    // Use home directory as cwd to avoid packageManager conflicts from local package.json
    const child = spawn(packageManager, updateArgs, {
      stdio: "inherit",
      shell: true,
      cwd: process.env.HOME || process.cwd(),
    });

    child.on("exit", (code) => {
      if (code === 0) {
        console.log(`\n✓ Successfully updated to version ${latestVersion}!`);
        process.exit(0);
      } else {
        console.error("\n✗ Update failed");
        console.error(`   Try manually: ${packageManager} ${updateArgs.join(" ")}`);
        process.exit(1);
      }
    });

    child.on("error", (error) => {
      console.error(`Failed to update: ${error.message}`);
      console.error(`   Try manually: ${packageManager} ${updateArgs.join(" ")}`);
      process.exit(1);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
