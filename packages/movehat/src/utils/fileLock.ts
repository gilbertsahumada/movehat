import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const LOCK_DIR_MODE = 0o700;
const LOCK_FILE_MODE = 0o600;
const DEFAULT_TIMEOUT_MS = 180_000;
const STALE_LOCK_MS = 10 * 60_000;

interface LockRecord {
  token: string;
  pid: number;
  createdAt: number;
}

export interface FileLockOptions {
  lockDir?: string;
  timeoutMs?: number;
  pollMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseLock(path: string): LockRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as LockRecord).token !== "string" ||
      !Number.isSafeInteger((value as LockRecord).pid) ||
      !Number.isFinite((value as LockRecord).createdAt)
    ) {
      return null;
    }
    return value as LockRecord;
  } catch {
    return null;
  }
}

function removeIfStale(path: string): boolean {
  try {
    const record = parseLock(path);
    const ageMs = Date.now() - statSync(path).mtimeMs;
    if (ageMs < STALE_LOCK_MS) return false;
    if (record && isProcessAlive(record.pid)) return false;
    unlinkSync(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function lockPath(lockDir: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return join(lockDir, `${digest}.lock`);
}

/**
 * Cross-process advisory lock backed by an atomically-created 0o600 file.
 * Keys are hashed before becoming filenames, so untrusted network/module
 * names cannot influence the lock path.
 */
export async function withFileLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lockDir = options.lockDir ?? join(process.cwd(), ".movehat", "locks");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 50;
  mkdirSync(lockDir, { recursive: true, mode: LOCK_DIR_MODE });
  chmodSync(lockDir, LOCK_DIR_MODE);

  const path = lockPath(lockDir, key);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  let fd: number | undefined;

  while (fd === undefined) {
    try {
      fd = openSync(path, "wx", LOCK_FILE_MODE);
      writeFileSync(fd, JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (removeIfStale(path)) continue;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for operation lock '${key}'`);
      }
      await sleep(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      closeSync(fd);
      const current = parseLock(path);
      if (current?.token === token && existsSync(path)) {
        unlinkSync(path);
      }
    } catch {
      // Lock cleanup must never mask the result (or original error) of the
      // protected operation. A stale file is reclaimed on the next attempt.
    }
  }
}

/** Acquire several locks in stable order to avoid cross-process deadlocks. */
export function withFileLocks<T>(
  keys: readonly string[],
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  const acquire = (index: number): Promise<T> => {
    const key = ordered[index];
    return key === undefined ? fn() : withFileLock(key, () => acquire(index + 1), options);
  };
  return acquire(0);
}
