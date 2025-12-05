import { pathToFileURL } from "url";
import { join } from "path";
import { existsSync } from "fs";
import { MovehatConfig } from "../types/config.js";

/**
 * Load Movehat configuration file
 * Supports both .ts and .js config files
 * Since the CLI runs with tsx, we can import .ts files directly
 */
export async function loadUserConfig(): Promise<MovehatConfig> {
  const cwd = process.cwd();

  // Try to find config file (.ts first, then .js)
  const possiblePaths = [
    join(cwd, "movehat.config.ts"),
    join(cwd, "movehat.config.js"),
  ];

  let configPath: string | null = null;
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      configPath = path;
      break;
    }
  }

  if (!configPath) {
    throw new Error(
      "Configuration file not found. Expected 'movehat.config.ts' or 'movehat.config.js' in the current directory."
    );
  }

  try {
    // With tsx, we can import both .ts and .js files directly
    const configUrl = pathToFileURL(configPath).href;
    // Add timestamp to bypass import cache
    const configModule = await import(configUrl + '?t=' + Date.now());
    return configModule.default as MovehatConfig;
  } catch (error) {
    throw new Error(`Failed to load configuration file '${configPath}': ${error}`);
  }
}
