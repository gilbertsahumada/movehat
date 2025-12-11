import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';

export interface AptosProfile {
  private_key?: string;
  public_key?: string;
  account?: string;
  rest_url?: string;
}

export interface AptosConfig {
  profiles: Record<string, AptosProfile>;
}

/**
 * Get the path to the Aptos config file
 */
export function getAptosConfigPath(): string {
  return join(homedir(), '.aptos', 'config.yaml');
}

/**
 * Read the Aptos config file
 */
export function readAptosConfig(): AptosConfig {
  const configPath = getAptosConfigPath();

  if (!existsSync(configPath)) {
    throw new Error(
      `Aptos config not found at ${configPath}\n` +
      `Please run 'aptos init' first to set up your Aptos CLI.`
    );
  }

  try {
    const configContent = readFileSync(configPath, 'utf-8');
    const config = yaml.load(configContent) as AptosConfig;

    if (!config.profiles || typeof config.profiles !== 'object') {
      throw new Error('Invalid Aptos config: missing profiles');
    }

    return config;
  } catch (error) {
    throw new Error(`Failed to read Aptos config: ${error}`);
  }
}

/**
 * Write the Aptos config file
 */
export function writeAptosConfig(config: AptosConfig): void {
  const configPath = getAptosConfigPath();

  try {
    const yamlContent = yaml.dump(config, {
      indent: 2,
      lineWidth: -1, // No line wrapping
      noRefs: true,
    });

    writeFileSync(configPath, yamlContent, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to write Aptos config: ${error}`);
  }
}

/**
 * Validate that a string is a well-formed HTTP/HTTPS URL
 */
function validateRestUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid protocol: ${parsed.protocol}. Must be http: or https:`);
    }
  } catch (error) {
    throw new Error(
      `Invalid rest_url: ${url}\n` +
      `Expected a well-formed HTTP/HTTPS URL (e.g., https://testnet.movementnetwork.xyz/v1)`
    );
  }
}

/**
 * Temporarily modify the rest_url of a profile
 * Returns a restore function to undo the change
 *
 * WARNING: This function is NOT safe for concurrent use.
 * Multiple simultaneous calls may result in race conditions.
 * Ensure exclusive access or implement file-level locking if needed.
 */
export function modifyRestUrl(
  profileName: string,
  newRestUrl: string
): () => void {
  // Validate URL before any modifications
  validateRestUrl(newRestUrl);

  const config = readAptosConfig();

  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(
      `Profile '${profileName}' not found in Aptos config.\n` +
      `Available profiles: ${Object.keys(config.profiles).join(', ')}`
    );
  }

  // Capture original rest_url in closure
  const originalRestUrl = profile.rest_url;

  // Modify rest_url
  profile.rest_url = newRestUrl;
  writeAptosConfig(config);

  // Return restore function that uses captured originalRestUrl
  return () => {
    try {
      const currentConfig = readAptosConfig();
      const currentProfile = currentConfig.profiles[profileName];

      if (currentProfile) {
        // Restore to the captured original value from closure
        currentProfile.rest_url = originalRestUrl;
        writeAptosConfig(currentConfig);
      } else {
        // Profile was deleted - log but don't error
        console.warn(`Profile '${profileName}' no longer exists, cannot restore rest_url`);
      }
    } catch (error) {
      console.error(`Failed to restore rest_url for profile '${profileName}':`, error);
    }
  };
}

/**
 * Get the rest_url for a specific profile
 */
export function getProfileRestUrl(profileName: string = 'default'): string | undefined {
  const config = readAptosConfig();
  return config.profiles[profileName]?.rest_url;
}

/**
 * Check if a profile exists
 */
export function profileExists(profileName: string): boolean {
  try {
    const config = readAptosConfig();
    return profileName in config.profiles;
  } catch {
    return false;
  }
}
