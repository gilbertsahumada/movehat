import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { logger } from "../ui/index.js";

export interface DeploymentInfo {
  address: string;
  moduleName: string;
  network: string;
  deployer: string;
  timestamp: number;
  txHash?: string | undefined;
  blockNumber?: string | undefined;
}

/**
 * Validates that a name is safe for use in file paths
 * Only allows alphanumeric characters, hyphens, and underscores
 * Prevents path traversal attacks
 */
export function validateSafeName(name: string, type: "network" | "module"): void {
  if (!name || typeof name !== "string") {
    throw new Error(`Invalid ${type} name: must be a non-empty string`);
  }

  // Check for path traversal sequences
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(
      `Invalid ${type} name: "${name}"\n` +
      `Path traversal sequences are not allowed.\n` +
      `Use only alphanumeric characters, hyphens, and underscores.`
    );
  }

  // Reject hidden-file names first so the error message is specific
  // (otherwise the alphanumeric check below would fire generically).
  if (name.startsWith(".")) {
    throw new Error(
      `Invalid ${type} name: "${name}"\n` +
      `Names cannot start with a dot (.) to prevent hidden file creation.`
    );
  }

  // Only allow alphanumeric, hyphens, underscores
  const safePattern = /^[a-zA-Z0-9_-]+$/;
  if (!safePattern.test(name)) {
    throw new Error(
      `Invalid ${type} name: "${name}"\n` +
      `Only alphanumeric characters, hyphens (-), and underscores (_) are allowed.`
    );
  }
}

function getDeploymentsDir(): string {
  return join(process.cwd(), "deployments");
}

function getNetworkDeploymentsDir(network: string): string {
  // Validate network name to prevent path traversal
  validateSafeName(network, "network");

  const deploymentsDir = getDeploymentsDir();
  const networkDir = join(deploymentsDir, network);

  // Create directories if they don't exist
  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true });
  }
  if (!existsSync(networkDir)) {
    mkdirSync(networkDir, { recursive: true });
  }

  return networkDir;
}

export function saveDeployment(deployment: DeploymentInfo): void {
  // Validate both network and module name
  validateSafeName(deployment.network, "network");
  validateSafeName(deployment.moduleName, "module");

  const networkDir = getNetworkDeploymentsDir(deployment.network);
  const filePath = join(networkDir, `${deployment.moduleName}.json`);

  try {
    writeFileSync(filePath, JSON.stringify(deployment, null, 2), "utf-8");
    logger.success(
      `Deployment saved: deployments/${deployment.network}/${deployment.moduleName}.json`
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      `Failed to save deployment for ${deployment.moduleName} on ${deployment.network} at ${filePath}: ${msg}`
    );
    throw error;
  }
}

export function loadDeployment(network: string, moduleName: string): DeploymentInfo | null {
  // Validate both network and module name
  validateSafeName(network, "network");
  validateSafeName(moduleName, "module");

  const networkDir = getNetworkDeploymentsDir(network);
  const filePath = join(networkDir, `${moduleName}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as DeploymentInfo;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load deployment for ${moduleName} on ${network}: ${msg}`);
    return null;
  }
}

/**
 * Get all deployments for a network
 */
export function getAllDeployments(network: string): Record<string, DeploymentInfo> {
  // Validate network name
  validateSafeName(network, "network");

  const networkDir = getNetworkDeploymentsDir(network);

  if (!existsSync(networkDir)) {
    return {};
  }

  const files = readdirSync(networkDir).filter((f: string) => f.endsWith(".json"));

  const deployments: Record<string, DeploymentInfo> = {};

  for (const file of files) {
    const moduleName = file.replace(".json", "");
    // loadDeployment will validate moduleName internally
    const deployment = loadDeployment(network, moduleName);
    if (deployment) {
      deployments[moduleName] = deployment;
    }
  }

  return deployments;
}

/**
 * Get deployed address for a module
 */
export function getDeployedAddress(network: string, moduleName: string): string | null {
  // Validation happens in loadDeployment
  const deployment = loadDeployment(network, moduleName);
  return deployment ? deployment.address : null;
}
