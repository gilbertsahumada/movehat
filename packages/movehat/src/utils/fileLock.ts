import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

const LOCK_DIR_MODE = 0o700;
const LOCK_FILE_MODE = 0o600;
const DEFAULT_TIMEOUT_MS = 180_000;
const WAIT_NOTICE_MS = 1_000;
const WAIT_PROGRESS_MS = 30_000;

interface LockRecord {
  token: string;
  pid: number;
  createdAt: number;
}

interface OwnedLock {
  path: string;
  token: string;
}

export interface FileLockOptions {
  lockDir?: string;
  timeoutMs?: number;
  pollMs?: number;
  onWait?: ((message: string) => void) | undefined;
}

const ownedLocks = new Map<string, OwnedLock>();
let signalHandlersInstalled = false;

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
      (value as LockRecord).token.length === 0 ||
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

function recordsEqual(
  left: LockRecord | null,
  right: LockRecord | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.token === right.token &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt
  );
}

/**
 * Move a lock out of the acquisition path before removing it. Re-reading the
 * moved file makes reclaim token-aware: if the observed owner changed, the
 * claimant never unlinks that owner's record.
 *
 * Lock records are immutable after their O_EXCL creation. A valid record is
 * reclaimed only after its PID is dead, so that owner can no longer run its
 * cleanup and install a successor between observation and rename. Competing
 * reclaimers serialize on the atomic rename; only one can remove the record.
 */
function removeObservedLock(
  path: string,
  observed: LockRecord | null,
): boolean {
  const movedPath = `${path}.reclaim-${process.pid}-${randomUUID()}`;
  try {
    renameSync(path, movedPath);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }

  const moved = parseLock(movedPath);
  if (!recordsEqual(observed, moved)) {
    try {
      renameSync(movedPath, path);
    } catch {
      // Another contender may already own path. Preserve the unexpected
      // record for diagnosis instead of deleting a lock we did not observe.
    }
    return false;
  }

  try {
    unlinkSync(movedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  return true;
}

function removeIfReclaimable(path: string): boolean {
  const record = parseLock(path);
  if (record !== null) {
    // A dead owner cannot release its lock, so reclaim immediately. A live
    // owner is authoritative regardless of how long the operation takes.
    if (isProcessAlive(record.pid)) return false;
    return removeObservedLock(path, record);
  }

  // Without a valid immutable token/PID there is no safe owner identity to
  // compare atomically. Never reclaim corrupt/partial records automatically.
  return false;
}

function releaseOwnedLock(lock: OwnedLock): void {
  const current = parseLock(lock.path);
  if (current?.token === lock.token) removeObservedLock(lock.path, current);
  ownedLocks.delete(lock.token);
}

function ensureSignalCleanup(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.prependOnceListener(signal, () => {
      // If another handler can keep the process alive, the protected function
      // is still running and must retain ownership. If no handler remains,
      // release synchronously and restore the platform's default termination.
      if (process.listenerCount(signal) > 0) return;
      for (const lock of [...ownedLocks.values()]) releaseOwnedLock(lock);
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

function defaultLockDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(realpathSync(tmpdir()), `movehat-${uid}`, "locks");
}

function assertNoSymlinkComponents(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const components = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    try {
      const componentStat = lstatSync(current);
      if (componentStat.isSymbolicLink()) {
        // macOS exposes system-owned compatibility links such as /var and
        // /tmp. They are immutable to an unprivileged caller; user-owned
        // links in the lock namespace are the substitution risk.
        if (typeof process.getuid !== "function" || componentStat.uid !== 0) {
          throw new Error(`Lock directory path must not contain user-owned symlinks: ${current}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function lockPath(lockDir: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return join(lockDir, `${digest}.lock`);
}

/** Cross-process advisory lock backed by an atomically-created 0o600 file. */
export async function withFileLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lockDir = options.lockDir ?? defaultLockDir();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 50;
  const onWait =
    options.onWait ??
    ((message: string) => process.stderr.write(`${message}\n`));
  assertNoSymlinkComponents(dirname(lockDir));
  assertNoSymlinkComponents(lockDir);
  mkdirSync(lockDir, { recursive: true, mode: LOCK_DIR_MODE });
  assertNoSymlinkComponents(lockDir);
  const lockDirStat = lstatSync(lockDir);
  if (typeof process.getuid === "function" && lockDirStat.uid !== process.getuid()) {
    throw new Error(`Lock directory is not owned by the current user: ${lockDir}`);
  }
  chmodSync(lockDir, LOCK_DIR_MODE);

  const path = lockPath(lockDir, key);
  const token = randomUUID();
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let nextNoticeAt = startedAt + WAIT_NOTICE_MS;
  let acquired = false;

  while (!acquired) {
    const candidatePath = join(lockDir, `.candidate-${process.pid}-${token}.tmp`);
    let candidateFd: number | undefined;
    try {
      candidateFd = openSync(candidatePath, "wx", LOCK_FILE_MODE);
      const record = { token, pid: process.pid, createdAt: Date.now() };
      try {
        writeFileSync(candidateFd, JSON.stringify(record), "utf8");
        fsyncSync(candidateFd);
      } catch (error) {
        throw error;
      } finally {
        closeSync(candidateFd);
        candidateFd = undefined;
      }
      // Hard-link publication is atomic and exclusive: contenders can only
      // observe no lock or the fully-written, fsynced immutable record.
      linkSync(candidatePath, path);
      acquired = true;
    } catch (error) {
      if (candidateFd !== undefined) closeSync(candidateFd);
      try { unlinkSync(candidatePath); } catch { /* preserve original error */ }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (removeIfReclaimable(path)) continue;
      const now = Date.now();
      if (now >= deadline)
        throw new Error(`Timed out waiting for operation lock '${key}'`);
      if (now >= nextNoticeAt) {
        onWait(`Waiting for another Movehat process to finish '${key}'...`);
        nextNoticeAt = now + WAIT_PROGRESS_MS;
      }
      await sleep(Math.min(pollMs, Math.max(0, deadline - now)));
      continue;
    }
    try { unlinkSync(candidatePath); } catch (error) {
      // Publication succeeded, but leaving a second hard link would retain
      // stale ownership after normal cleanup. Roll back our published token.
      releaseOwnedLock({ path, token });
      throw error;
    }
  }

  const lock = { path, token };
  ownedLocks.set(token, lock);
  ensureSignalCleanup();
  try {
    return await fn();
  } finally {
    try {
      releaseOwnedLock(lock);
    } catch {
      // Cleanup must not mask the protected operation. A dead-owner record is
      // reclaimed immediately by the next process.
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
    return key === undefined
      ? fn()
      : withFileLock(key, () => acquire(index + 1), options);
  };
  return acquire(0);
}
