import { chmodSync, unlinkSync, writeFileSync } from "fs";
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
 * Synchronous unlink of a temp key file. Idempotent — a missing
 * file is a no-op. Used both by the async finally-block path and
 * by the SIGINT/SIGTERM handler (where the event loop is dead and
 * we cannot await).
 *
 * Signal handlers must never throw, so all filesystem errors are
 * swallowed. The worst case is a stale temp file in `os.tmpdir()`,
 * which the OS will clean up on its own schedule.
 */
export function removeKeyFileSync(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // best-effort
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
