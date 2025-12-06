import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface DeploymentInfo {
  address: string;
  moduleName: string;
  network: string;
  deployer: string;
  timestamp: number;
  txHash?: string;
  blockNumber?: string;
}

/**
 * Get the deployments directory path
 */
function getDeploymentsDir(): string {
  return join(process.cwd(), "deployments");
}

/**
 * Get the network-specific deployments directory
 */
function getNetworkDeploymentsDir(network: string): string {
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

/**
 * Save a deployment
 */
export function saveDeployment(deployment: DeploymentInfo): void {
  const networkDir = getNetworkDeploymentsDir(deployment.network);
  const filePath = join(networkDir, `${deployment.moduleName}.json`);

  writeFileSync(filePath, JSON.stringify(deployment, null, 2), "utf-8");

  console.log(`💾 Deployment saved: deployments/${deployment.network}/${deployment.moduleName}.json`);
}

/**
 * Load a deployment
 */
export function loadDeployment(network: string, moduleName: string): DeploymentInfo | null {
  const networkDir = getNetworkDeploymentsDir(network);
  const filePath = join(networkDir, `${moduleName}.json`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content) as DeploymentInfo;
  } catch (error) {
    console.error(`Failed to load deployment for ${moduleName} on ${network}:`, error);
    return null;
  }
}

/**
 * Get all deployments for a network
 */
export function getAllDeployments(network: string): Record<string, DeploymentInfo> {
  const networkDir = getNetworkDeploymentsDir(network);

  if (!existsSync(networkDir)) {
    return {};
  }

  const { readdirSync } = require("fs");
  const files = readdirSync(networkDir).filter((f: string) => f.endsWith(".json"));

  const deployments: Record<string, DeploymentInfo> = {};

  for (const file of files) {
    const moduleName = file.replace(".json", "");
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
  const deployment = loadDeployment(network, moduleName);
  return deployment ? deployment.address : null;
}
