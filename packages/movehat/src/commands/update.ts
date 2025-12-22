import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { isNewerVersion } from "../helpers/semver-utils.js";
import { fetchLatestVersion } from "../helpers/npm-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageJson {
  name: string;
  version: string;
}

/**
 * Detect which package manager to use for update
 * Searches for lockfiles upward from cwd, checks user agent, or falls back to defaults
 */
function detectPackageManager(): "yarn" | "npm" | "pnpm" {
  // First, try to detect from lockfiles by searching upward
  let currentDir = process.cwd();
  const root = resolve("/");

  while (currentDir !== root) {
    if (existsSync(join(currentDir, "pnpm-lock.yaml"))) {
      return "pnpm";
    }
    if (existsSync(join(currentDir, "yarn.lock"))) {
      return "yarn";
    }
    if (
      existsSync(join(currentDir, "package-lock.json")) ||
      existsSync(join(currentDir, "npm-shrinkwrap.json"))
    ) {
      return "npm";
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break; // Reached root
    currentDir = parentDir;
  }

  // No lockfile found, check user agent environment variables
  const userAgent =
    process.env.npm_config_user_agent || process.env.npm_execpath || "";

  if (userAgent.includes("pnpm")) {
    return "pnpm";
  }
  if (userAgent.includes("yarn")) {
    return "yarn";
  }
  if (userAgent.includes("npm")) {
    return "npm";
  }

  // Default fallback to npm for global installs
  return "npm";
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
    const latestVersion = await fetchLatestVersion(packageName, {
      throwOnError: true,
    });

    if (!latestVersion) {
      console.error("Failed to fetch latest version from npm registry");
      process.exit(1);
    }

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
      cwd: homedir() || process.cwd(),
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
