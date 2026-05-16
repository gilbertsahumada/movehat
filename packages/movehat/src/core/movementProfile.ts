import { chmodSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

/**
 * Per-deploy private-key file management and SIGINT/SIGTERM cleanup
 * infrastructure shared across the Movement CLI invocations (`move
 * publish`, `move deploy-object`, `move upgrade-object`, `move
 * run-script`).
 *
 * **Why a temp key file rather than the CLI's profile yaml?** The
 * Movement CLI's `--profile <name>` flag requires a config.yaml to
 * exist in the working directory (older Movement CLI variants look
 * for `<cwd>/.aptos/config.yaml`; newer variants look for
 * `<cwd>/.movement/config.yaml`). On fresh user installs neither
 * directory exists, and the CLI errors out before it would otherwise
 * fall back to `~/.aptos/config.yaml`. Writing to a temp file and
 * passing `--private-key-file <path> --sender-account <addr>`
 * directly avoids the entire profile-yaml lookup chain — no CWD
 * dependency, no CLI-variant dependency.
 *
 * The same SIGINT-safe cleanup pattern applies as the old profile
 * flow: the temp key file persists private key material on disk and
 * MUST be removed before process exit even on abnormal termination.
 *
 * @internal — not exported from `src/index.ts`.
 */

/**
 * Write the private key to a `mode 0o600` file in the system temp
 * directory and return the path. The filename is UUID-suffixed so
 * concurrent deploys don't collide.
 *
 * The key string is written verbatim — callers should format to
 * AIP-80 before calling (see `PrivateKey.formatPrivateKey` from
 * `@aptos-labs/ts-sdk`).
 */
export function writeTempKeyFile(privateKey: string): string {
  const path = join(tmpdir(), `movehat-key-${randomUUID()}`);
  // mode in the open() call may be filtered by the process umask
  // (typically 0o022 → resulting perms 0o644). chmod after write
  // is defense in depth so the file can never be observable as
  // group-/world-readable while it carries the private key.
  writeFileSync(path, privateKey, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/**
 * Sync unlink for SIGINT/SIGTERM handlers — never throws, never logs.
 * The event loop is dead by the time this runs; observability isn't
 * possible. Worst case: a stale 0o600 temp file in `os.tmpdir()`
 * that the OS reaps eventually.
 *
 * **Do not use this from a normal `finally` cleanup path** — failures
 * become invisible there, hiding the case where a private-key temp
 * file persists on disk after a deploy. Use {@link removeKeyFile}
 * instead for those paths.
 */
export function removeKeyFileSyncBestEffort(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // event loop dead — best-effort
  }
}

/**
 * Sync unlink for the normal cleanup path (a `finally` block after the
 * Movement CLI invocation returns). Returns `null` on success — either
 * the file was removed, or it was already gone (ENOENT is treated as
 * benign success). Returns an `Error` only when the file **still
 * exists on disk** after the unlink attempt failed (EPERM, EACCES,
 * EBUSY, EISDIR if the path collided with a directory, etc.).
 *
 * Callers SHOULD `logger.warning` when a non-null Error is returned —
 * a private-key temp file would otherwise persist silently.
 */
export function removeKeyFile(path: string): Error | null {
  try {
    unlinkSync(path);
    return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // The unlink call failed but verify the file actually still exists
    // before declaring this preocupante — some races (parallel cleanup,
    // tmpdir reaper) can race with us and the file may already be gone
    // despite the syscall reporting an unexpected error.
    if (!existsSync(path)) return null;
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Process-level signal handling. A single registered handler iterates
 * the per-deploy cleanup callbacks. Installed once per process because
 * multiple concurrent deploys share the same parent — installing per
 * deploy would re-add the listener and exceed Node's max-listeners
 * warning threshold under heavy parallelism.
 */
export const cleanupCallbacks = new Set<() => void>();
let signalHandlerInstalled = false;

export function ensureSignalHandler(): void {
  if (signalHandlerInstalled) return;
  signalHandlerInstalled = true;
  const handler = (sig: NodeJS.Signals) => {
    // Synchronous cleanup of every active deploy's resources.
    for (const cb of [...cleanupCallbacks]) {
      try {
        cb();
      } catch {
        /* sync best-effort */
      }
    }
    // Defer the actual exit one tick so other listeners (vitest's own
    // SIGINT handler, app-level shutdown hooks) still get to run.
    // Without this we'd stomp on vitest's afterEach if a dev Ctrl+C'd
    // a test run mid-suite.
    const code = sig === "SIGTERM" ? 143 : 130;
    setImmediate(() => process.exit(code));
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
