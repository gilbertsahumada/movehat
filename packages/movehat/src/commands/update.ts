import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import prompts from "prompts";
import { isNewerVersion } from "../helpers/semver-utils.js";
import { fetchLatestVersion } from "../helpers/npm-registry.js";
import { logger, withSpinner, box, colors } from "../ui/index.js";

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
 * Update Movehat CLI to the latest version from npm
 *
 * This command:
 * - Fetches the latest version from npm registry
 * - Compares with currently installed version
 * - Auto-detects package manager (npm/yarn/pnpm)
 * - Installs the update if a newer version is available
 *
 * @example
 * // Update to latest version
 * await updateCommand();
 */
export default async function updateCommand() {
  try {
    // Read current version from package.json
    const packageJsonPath = join(__dirname, "../../package.json");
    const packageJson: PackageJson = JSON.parse(
      readFileSync(packageJsonPath, "utf-8")
    );

    const currentVersion = packageJson.version;
    const packageName = packageJson.name;

    logger.newline();
    logger.info(`Current version: ${currentVersion}`);

    // Fetch latest version from npm with spinner
    const latestVersion = await withSpinner(
      'Checking for updates...',
      async () => await fetchLatestVersion(packageName, { throwOnError: true }),
      'Update check complete'
    );

    if (!latestVersion) {
      logger.error("Failed to fetch latest version from npm registry");
      logger.newline();
      process.exit(1);
    }

    logger.info(`Latest version: ${latestVersion}`);
    logger.newline();

    // Compare versions
    if (!isNewerVersion(currentVersion, latestVersion)) {
      logger.success('You are already using the latest version!');
      logger.newline();
      return;
    }

    // Show update available box
    const updateBox = box(
      `${colors.brandBright('Update Available!')}\n\n` +
      `Current: ${currentVersion}\n` +
      `Latest:  ${colors.success(latestVersion)}`,
      { borderColor: 'warning', padding: 1 }
    );
    console.log(updateBox);
    logger.newline();

    // Ask for confirmation
    const response = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: `Do you want to update to version ${latestVersion}?`,
      initial: true
    });

    if (!response.confirm) {
      logger.info('Update cancelled');
      logger.newline();
      return;
    }

    logger.newline();
    logger.info('Updating movehat...');
    logger.newline();

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
        logger.newline();
        logger.success(`Successfully updated to version ${latestVersion}!`);
        logger.newline();
        process.exit(0);
      } else {
        logger.newline();
        logger.error('Update failed');
        logger.plain(`   Try manually: ${packageManager} ${updateArgs.join(" ")}`);
        logger.newline();
        process.exit(1);
      }
    });

    child.on("error", (error) => {
      logger.newline();
      logger.error(`Failed to update: ${error.message}`);
      logger.plain(`   Try manually: ${packageManager} ${updateArgs.join(" ")}`);
      logger.newline();
      process.exit(1);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.newline();
    logger.error(`Error: ${message}`);
    logger.newline();
    process.exit(1);
  }
}
