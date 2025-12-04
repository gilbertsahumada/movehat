import { pathToFileURL } from "url";
import { join } from "path";
import { existsSync } from "fs";

export async function loadUserConfig() {
  const configPath = join(process.cwd(), "movehat.config.js");
  if (!existsSync(configPath)) {
    throw new Error(
      "Configuration file 'movehat.config.js' not found in the current directory."
    );
  }

  try {
    const configUrl = pathToFileURL(configPath).href;
    const configModule = await import(configUrl);
    return configModule.default;
  } catch (error) {
    throw new Error(`Failed to load configuration file: ${error}`);
  }
}
