import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { createHash, randomUUID } from "node:crypto";
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
  /** Additive persistence schema marker. Missing means the legacy v1 shape. */
  schemaVersion?: 2 | undefined;
  chainId?: string | undefined;
  rpcFingerprint?: string | undefined;
  artifactHash?: string | undefined;
  cliVersion?: string | undefined;
  compilerVersion?: string | undefined;
  kind?: "publish" | "code-object" | "upgrade-object" | undefined;
  previousTxHash?: string | undefined;
}

export class InvalidPersistedStateError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InvalidPersistedStateError";
  }
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

  return networkDir;
}

function ensureNetworkDeploymentsDir(network: string): string {
  const networkDir = getNetworkDeploymentsDir(network);
  mkdirSync(networkDir, { recursive: true, mode: 0o700 });
  chmodSync(getDeploymentsDir(), 0o700);
  chmodSync(networkDir, 0o700);
  return networkDir;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

export function parseDeploymentInfo(
  value: unknown,
  expected?: { network: string; moduleName: string },
): DeploymentInfo {
  if (!isRecord(value)) throw new Error("Deployment record must be a JSON object");
  const required = ["address", "moduleName", "network", "deployer"] as const;
  for (const key of required) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw new Error(`Deployment record field '${key}' must be a non-empty string`);
    }
  }
  if (!Number.isFinite(value.timestamp) || (value.timestamp as number) < 0) {
    throw new Error("Deployment record field 'timestamp' must be a non-negative number");
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== 2) {
    throw new Error(`Unsupported deployment schema version '${String(value.schemaVersion)}'`);
  }
  for (const key of [
    "txHash",
    "blockNumber",
    "chainId",
    "rpcFingerprint",
    "artifactHash",
    "cliVersion",
    "compilerVersion",
    "previousTxHash",
  ] as const) {
    if (!isOptionalString(value[key])) {
      throw new Error(`Deployment record field '${key}' must be a string when present`);
    }
  }
  if (
    value.kind !== undefined &&
    value.kind !== "publish" &&
    value.kind !== "code-object" &&
    value.kind !== "upgrade-object"
  ) {
    throw new Error("Deployment record field 'kind' is invalid");
  }
  validateSafeName(value.network as string, "network");
  validateSafeName(value.moduleName as string, "module");
  if (
    expected &&
    (value.network !== expected.network || value.moduleName !== expected.moduleName)
  ) {
    throw new Error("Deployment record identity does not match its path");
  }
  return value as unknown as DeploymentInfo;
}

export function fingerprintRpcUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return createHash("sha256").update(parsed.toString()).digest("hex");
}

export function sanitizeRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "<invalid-url>";
  }
}

/** Hash the deterministic Move artifacts used for a publish/upgrade. */
export function hashBuildArtifacts(packageDir: string): string | undefined {
  const buildDir = join(packageDir, "build");
  if (!existsSync(buildDir)) return undefined;
  const hash = createHash("sha256");
  let files = 0;

  const visit = (dir: string, relativeDir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, relative);
      } else if (entry.isFile() && /\.(?:bcs|mv|json)$/.test(entry.name)) {
        hash.update(relative);
        hash.update("\0");
        hash.update(readFileSync(absolute));
        hash.update("\0");
        files += 1;
      }
    }
  };

  visit(buildDir, "");
  return files > 0 ? hash.digest("hex") : undefined;
}

export function assertDeploymentEnvironment(
  deployment: DeploymentInfo,
  current: { chainId?: string; rpc: string },
): void {
  if (
    deployment.chainId !== undefined &&
    current.chainId !== undefined &&
    deployment.chainId !== current.chainId
  ) {
    throw new InvalidPersistedStateError(
      `Deployment chain ID '${deployment.chainId}' does not match active chain '${current.chainId}'`,
      `deployments/${deployment.network}/${deployment.moduleName}.json`,
    );
  }
  const currentFingerprint = fingerprintRpcUrl(current.rpc);
  if (
    deployment.rpcFingerprint !== undefined &&
    deployment.rpcFingerprint !== currentFingerprint
  ) {
    throw new InvalidPersistedStateError(
      "Deployment RPC identity does not match the active network configuration",
      `deployments/${deployment.network}/${deployment.moduleName}.json`,
    );
  }
}

export function saveDeployment(deployment: DeploymentInfo): void {
  // Validate both network and module name
  validateSafeName(deployment.network, "network");
  validateSafeName(deployment.moduleName, "module");

  parseDeploymentInfo(deployment);
  const networkDir = ensureNetworkDeploymentsDir(deployment.network);
  const filePath = join(networkDir, `${deployment.moduleName}.json`);
  const tempPath = join(networkDir, `.${deployment.moduleName}.${randomUUID()}.tmp`);

  try {
    const fd = openSync(tempPath, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(deployment, null, 2), "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, filePath);
    chmodSync(filePath, 0o600);
    logger.success(
      `Deployment saved: deployments/${deployment.network}/${deployment.moduleName}.json`
    );
  } catch (error) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Preserve the original persistence error.
    }
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
    return parseDeploymentInfo(JSON.parse(content) as unknown, { network, moduleName });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to load deployment for ${moduleName} on ${network}: ${msg}`);
    throw new InvalidPersistedStateError(
      `Invalid deployment record for ${moduleName} on ${network}: ${msg}`,
      filePath,
      error instanceof Error ? { cause: error } : undefined,
    );
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
