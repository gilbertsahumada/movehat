import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from 'fs';
import { randomUUID } from 'node:crypto';
import { join } from 'path';
import type { ForkMetadata, AccountState } from '../types/fork.js';
import { isHexAddress } from '../utils/address.js';
import { assertForkMetadata, assertAccountStateRecord } from './validation.js';
import { logger } from '../ui/index.js';
import { ForkCacheGenerationTransitionError } from './errors.js';

/**
 * Sanitize address to create a safe filename. Validates the address through
 * the shared `isHexAddress` helper (length 1–64 hex chars, optional `0x`),
 * then rebuilds a canonical `0x…` form. The trailing path-separator check is
 * defense-in-depth: unreachable after `isHexAddress`, but cheap to keep.
 */
function sanitizeAddressForFilename(address: string): string {
  if (!isHexAddress(address)) {
    throw new Error(`Invalid address format: ${address}. Expected hexadecimal string.`);
  }

  const normalized = address.toLowerCase().replace(/^0x/, '');
  const safe = `0x${normalized}`;

  if (safe.includes('/') || safe.includes('\\') || safe.includes('..')) {
    throw new Error(`Address contains invalid characters: ${address}`);
  }

  return safe;
}

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function ensurePrivateDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  }
  chmodSync(path, PRIVATE_DIR_MODE);
}

function writePrivateFile(path: string, data: string): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, data, { mode: PRIVATE_FILE_MODE });
    chmodSync(temporaryPath, PRIVATE_FILE_MODE);
    renameSync(temporaryPath, path);
    chmodSync(path, PRIVATE_FILE_MODE);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

const LEGACY_MIGRATION_MARKER = '.resource-cache-v1';
const CACHE_GENERATION_FILE = '.generation';
const CACHE_GENERATION_TRANSITION_PREFIX = 'transition:';
const CACHE_COMPLETE_GENERATION_PREFIX = 'generation:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ForkStorageTestHooks {
  beforeLegacyMarkerWrite?: ((address: string) => void) | undefined;
  beforeAllResourcesMarkerRead?: ((address: string) => void) | undefined;
}

let testHooks: ForkStorageTestHooks | undefined;

/** @internal Test-only scheduling hooks; this module is not a package export. */
export function __setForkStorageTestHooks(hooks?: ForkStorageTestHooks): void {
  testHooks = hooks;
}

function generationPath(forkPath: string): string {
  return join(forkPath, 'cache', CACHE_GENERATION_FILE);
}

function generationCompleteMarker(generation: string): string {
  if (!UUID_RE.test(generation)) {
    throw new Error('Cannot write a cache marker for an invalid fork generation');
  }
  return `${CACHE_COMPLETE_GENERATION_PREFIX}${generation}\n`;
}

/**
 * Publish an in-progress marker before changing metadata or clearing caches.
 * Readers that overlap the rotation fail closed; the stable UUID is committed
 * only after every related file mutation succeeds.
 *
 * @internal This module is not a package export.
 */
export function beginCacheGenerationTransition(forkPath: string): string {
  const cacheDir = join(forkPath, 'cache');
  ensurePrivateDirectory(cacheDir);
  const generation = randomUUID();
  writePrivateFile(
    generationPath(forkPath),
    `${CACHE_GENERATION_TRANSITION_PREFIX}${generation}\n`
  );
  return generation;
}

/** @internal This module is not a package export. */
export function commitCacheGenerationTransition(
  forkPath: string,
  generation: string
): void {
  if (!UUID_RE.test(generation)) {
    throw new Error('Cannot commit an invalid fork cache generation');
  }
  writePrivateFile(generationPath(forkPath), `${generation}\n`);
}

function readJsonFile<T>(path: string, label: string): T {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Invalid JSON in ${label} at ${path}. Expected an object.`);
    }
    return value as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${label} at ${path}. Delete or repair the file and retry.`);
    }
    throw error;
  }
}

function readLegacyResourceMap(path: string): Record<string, unknown> {
  const resources = readJsonFile<Record<string, unknown>>(path, 'fork resources');
  for (const [resourceType, data] of Object.entries(resources)) {
    if (
      resourceType.length === 0 ||
      data === null ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw new Error(
        `Invalid legacy fork resources at ${path}. Expected an object-shaped resource map.`
      );
    }
  }
  return resources;
}

/**
 * Migrate a 0.6.x resource cache while binding every completeness marker to
 * the generation observed by the caller. If another process rotates the
 * snapshot mid-migration, the old markers remain invalid in the new
 * generation even though the caller can only detect the change afterwards.
 *
 * @internal This module is not a package export.
 */
export function migrateLegacyResourceCacheAtGeneration(
  forkPath: string,
  generation: string
): void {
  const cacheDir = join(forkPath, 'cache');
  const resourcesDir = join(forkPath, 'resources');
  ensurePrivateDirectory(cacheDir);
  const completeMarker = generationCompleteMarker(generation);
  const migrationMarker = join(cacheDir, LEGACY_MIGRATION_MARKER);
  if (existsSync(migrationMarker)) return;

  if (existsSync(resourcesDir)) {
    for (const file of readdirSync(resourcesDir).sort()) {
      if (!/^0x[0-9a-fA-F]{1,64}\.json$/.test(file)) continue;
      const legacyPath = join(resourcesDir, file);
      // Validate legacy JSON before declaring it complete. 0.6.0 wrote these
      // files non-atomically, so a crash can leave truncated JSON behind —
      // quarantine such files instead of failing the whole fork (0.6.0's
      // resetState flow deleted them unread).
      try {
        readLegacyResourceMap(legacyPath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const quarantinePath = `${legacyPath}.corrupt-${Date.now()}-${randomUUID()}.bak`;
        try {
          renameSync(legacyPath, quarantinePath);
        } catch (renameError) {
          // The file listed by readdirSync is already gone — another process
          // cleared the cache mid-scan. Nothing to quarantine; the address
          // simply stays uncached and is refetched on demand.
          if ((renameError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw renameError;
        }
        logger.warning(
          `Skipping unreadable legacy fork resource cache ${file}: ${msg} ` +
            `Moved to ${quarantinePath}; the address will be refetched on demand.`
        );
        continue;
      }
      const address = file.slice(0, -'.json'.length);
      const marker = join(cacheDir, `${sanitizeAddressForFilename(address)}.all-resources`);
      testHooks?.beforeLegacyMarkerWrite?.(address);
      if (!existsSync(marker)) writePrivateFile(marker, completeMarker);
    }
  }
  writePrivateFile(migrationMarker, 'complete\n');
}

/**
 * Storage system for fork state
 * Manages the file structure and I/O for fork data
 */
export class ForkStorage {
  private forkPath: string;

  constructor(forkPath: string) {
    this.forkPath = forkPath;
  }

  /**
   * Get safe resource file path for an address
   * Prevents path traversal attacks
   */
  private getResourceFilePath(address: string): string {
    const safeFilename = sanitizeAddressForFilename(address);
    return join(this.forkPath, 'resources', `${safeFilename}.json`);
  }

  private getAllResourcesMarkerPath(address: string): string {
    const safeFilename = sanitizeAddressForFilename(address);
    return join(this.forkPath, 'cache', `${safeFilename}.all-resources`);
  }

  getCacheGeneration(): string {
    const cacheDir = join(this.forkPath, 'cache');
    ensurePrivateDirectory(cacheDir);
    const path = generationPath(this.forkPath);
    if (!existsSync(path)) {
      const generation = randomUUID();
      writePrivateFile(path, `${generation}\n`);
      return generation;
    }
    const generation = readFileSync(path, 'utf8').trim();
    if (generation.startsWith(CACHE_GENERATION_TRANSITION_PREFIX)) {
      throw new ForkCacheGenerationTransitionError(path);
    }
    if (!UUID_RE.test(generation)) {
      throw new Error(`Invalid fork cache generation at ${path}`);
    }
    return generation;
  }

  advanceCacheGeneration(): string {
    const generation = randomUUID();
    const cacheDir = join(this.forkPath, 'cache');
    ensurePrivateDirectory(cacheDir);
    commitCacheGenerationTransition(this.forkPath, generation);
    return generation;
  }

  /**
   * Initialize fork directory structure
   */
  initialize(): void {
    // Create main fork directory
    ensurePrivateDirectory(this.forkPath);

    // Create subdirectories
    const resourcesDir = join(this.forkPath, 'resources');
    ensurePrivateDirectory(resourcesDir);

    const cacheDir = join(this.forkPath, 'cache');
    ensurePrivateDirectory(cacheDir);

    // Create .gitignore for cache
    const gitignorePath = join(cacheDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writePrivateFile(gitignorePath, '*\n!.gitignore\n');
    }

    // Initialize accounts.json if it doesn't exist
    const accountsPath = join(this.forkPath, 'accounts.json');
    if (!existsSync(accountsPath)) {
      writePrivateFile(accountsPath, JSON.stringify({}, null, 2));
    } else {
      chmodSync(accountsPath, PRIVATE_FILE_MODE);
    }

    const migrationMarker = join(cacheDir, LEGACY_MIGRATION_MARKER);
    if (!existsSync(migrationMarker)) writePrivateFile(migrationMarker, 'complete\n');
    const path = generationPath(this.forkPath);
    if (!existsSync(path)) {
      writePrivateFile(path, `${randomUUID()}\n`);
    } else {
      chmodSync(path, PRIVATE_FILE_MODE);
    }
  }

  /**
   * Upgrade 0.6.x caches without contacting the upstream node. Each legacy
   * resource file represented a complete account resource response, including
   * an empty `{}` response. Per-address markers are committed first and the
   * global marker last, making interruption safe and the migration idempotent.
   */
  migrateLegacyResourceCache(): void {
    migrateLegacyResourceCacheAtGeneration(this.forkPath, this.getCacheGeneration());
  }

  /**
   * Check if fork exists
   */
  exists(): boolean {
    return existsSync(this.forkPath) && existsSync(join(this.forkPath, 'metadata.json'));
  }

  /**
   * Save fork metadata
   */
  saveMetadata(metadata: ForkMetadata): void {
    const metadataPath = join(this.forkPath, 'metadata.json');
    writePrivateFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Load fork metadata
   */
  loadMetadata(): ForkMetadata {
    const metadataPath = join(this.forkPath, 'metadata.json');

    if (!existsSync(metadataPath)) {
      throw new Error(`Fork metadata not found at ${metadataPath}`);
    }

    return assertForkMetadata(readJsonFile<unknown>(metadataPath, 'fork metadata'));
  }

  /**
   * Get account state
   */
  getAccount(address: string): AccountState | null {
    const accountsPath = join(this.forkPath, 'accounts.json');

    if (!existsSync(accountsPath)) {
      return null;
    }

    const accounts = assertAccountStateRecord(readJsonFile<unknown>(accountsPath, 'fork accounts'));
    return Object.prototype.hasOwnProperty.call(accounts, address)
      ? accounts[address] ?? null
      : null;
  }

  /**
   * Save account state
   */
  saveAccount(address: string, state: AccountState): void {
    const accountsPath = join(this.forkPath, 'accounts.json');

    let accounts: Record<string, AccountState> = {};
    if (existsSync(accountsPath)) {
      accounts = assertAccountStateRecord(readJsonFile<unknown>(accountsPath, 'fork accounts'));
    }

    accounts[address] = state;
    writePrivateFile(accountsPath, JSON.stringify(accounts, null, 2));
  }

  /**
   * Get resource for an account
   */
  getResource(address: string, resourceType: string): unknown | null {
    const resourceFilePath = this.getResourceFilePath(address);

    if (!existsSync(resourceFilePath)) {
      return null;
    }

    const resources = readJsonFile<Record<string, unknown>>(resourceFilePath, 'fork resources');
    return Object.prototype.hasOwnProperty.call(resources, resourceType)
      ? resources[resourceType]
      : null;
  }

  /**
   * Get all resources for an account
   */
  getAllResources(address: string): Record<string, unknown> {
    const resourceFilePath = this.getResourceFilePath(address);

    if (!existsSync(resourceFilePath)) {
      return {};
    }

    return readJsonFile<Record<string, unknown>>(resourceFilePath, 'fork resources');
  }

  /**
   * Save resource for an account
   */
  saveResource(address: string, resourceType: string, data: unknown): void {
    const resourceFilePath = this.getResourceFilePath(address);

    // Ensure resources directory exists
    const resourcesDir = join(this.forkPath, 'resources');
    ensurePrivateDirectory(resourcesDir);

    let resources: Record<string, unknown> = {};
    if (existsSync(resourceFilePath)) {
      resources = readJsonFile<Record<string, unknown>>(resourceFilePath, 'fork resources');
    }

    resources[resourceType] = data;
    writePrivateFile(resourceFilePath, JSON.stringify(resources, null, 2));

  }

  /**
   * Save all resources for an account
   */
  saveAllResources(address: string, resources: Record<string, unknown>): void {
    // Capture the generation before writing data. If a snapshot replacement
    // races this operation, the marker remains tied to the old generation and
    // cannot declare files from the replacement snapshot complete.
    const completeMarker = generationCompleteMarker(this.getCacheGeneration());
    const resourceFilePath = this.getResourceFilePath(address);

    // Ensure resources directory exists
    const resourcesDir = join(this.forkPath, 'resources');
    ensurePrivateDirectory(resourcesDir);

    writePrivateFile(resourceFilePath, JSON.stringify(resources, null, 2));

    const cacheDir = join(this.forkPath, 'cache');
    ensurePrivateDirectory(cacheDir);
    writePrivateFile(this.getAllResourcesMarkerPath(address), completeMarker);
  }

  /**
   * Check if resource is cached
   */
  hasResource(address: string, resourceType: string): boolean {
    const resourceFilePath = this.getResourceFilePath(address);
    if (!existsSync(resourceFilePath)) return false;
    const resources = readJsonFile<Record<string, unknown>>(resourceFilePath, 'fork resources');
    return Object.prototype.hasOwnProperty.call(resources, resourceType);
  }

  /**
   * A complete-snapshot marker is only trusted alongside its data file.
   * `saveAllResources` always writes the data file before the marker (including
   * an empty `{}` snapshot), so a marker without data means the pair was torn
   * apart — by a concurrent `clearResources()` or an interrupted write — and the
   * address must be refetched rather than served as an empty snapshot.
   */
  hasAllResources(address: string): boolean {
    const markerPath = this.getAllResourcesMarkerPath(address);
    if (!existsSync(markerPath) || !existsSync(this.getResourceFilePath(address))) {
      return false;
    }

    testHooks?.beforeAllResourcesMarkerRead?.(address);
    const marker = readFileSync(markerPath, 'utf8').trim();
    // 0.6/0.7 markers predate generation scoping. Continue accepting them
    // when adopting existing snapshots; all markers written by this version
    // are generation-scoped and therefore safe across concurrent rotations.
    if (marker === 'complete') return true;
    if (!marker.startsWith(CACHE_COMPLETE_GENERATION_PREFIX)) return false;

    const markerGeneration = marker.slice(CACHE_COMPLETE_GENERATION_PREFIX.length);
    if (!UUID_RE.test(markerGeneration)) return false;
    return markerGeneration === this.getCacheGeneration();
  }

  /**
   * List all accounts in the fork
   */
  listAccounts(): string[] {
    const accountsPath = join(this.forkPath, 'accounts.json');

    if (!existsSync(accountsPath)) {
      return [];
    }

    const accounts = assertAccountStateRecord(readJsonFile<unknown>(accountsPath, 'fork accounts'));
    return Object.keys(accounts);
  }

  /**
   * Clear all cached accounts
   * Resets accounts.json to empty object
   */
  clearAccounts(): void {
    const accountsPath = join(this.forkPath, 'accounts.json');
    writePrivateFile(accountsPath, JSON.stringify({}, null, 2));
  }

  /**
   * Clear all cached resources
   * Deletes all resource files from the resources directory
   */
  clearResources(): void {
    const resourcesDir = join(this.forkPath, 'resources');

    const cacheDir = join(this.forkPath, 'cache');
    if (existsSync(cacheDir)) {
      for (const file of readdirSync(cacheDir)) {
        if (file.endsWith('.all-resources')) unlinkSync(join(cacheDir, file));
      }
    }

    if (!existsSync(resourcesDir)) {
      return;
    }

    // Read all files in resources directory
    const files = readdirSync(resourcesDir);

    // Delete each resource file
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = join(resourcesDir, file);
        unlinkSync(filePath);
      }
    }
  }
}
