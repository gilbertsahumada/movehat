import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { readFile } from "fs/promises";
import { dirname } from "path";
import { randomUUID } from "crypto";
import * as yaml from "js-yaml";

/**
 * Shared helpers for working with the Movement CLI's `~/.aptos/config.yaml`
 * profile file and the SIGINT/SIGTERM cleanup pipeline.
 *
 * Extracted from `core/Publisher.ts` so both the existing `move publish`
 * flow (`Publisher`) and the new `move deploy-object` / `upgrade-object`
 * flows (`harness/codeObject.ts`) can share the bug #36 / #37 / #43
 * hardening without duplicating it.
 *
 * @internal — not exported from `src/index.ts`.
 */

/**
 * In-process serializer for `~/.aptos/config.yaml` mutations. Without it,
 * two concurrent profile writes would race in the read-modify-write cycle
 * and the second writer would silently drop the first's profile. See #37.
 */
let yamlLock: Promise<unknown> = Promise.resolve();
export function withYamlLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = yamlLock;
  // .then(success, failure) — continue even if the previous holder rejected,
  // so a failure in one deploy doesn't poison the lock for the others.
  const next = prev.then(
    () => fn(),
    () => fn()
  );
  yamlLock = next.catch(() => {}); // swallow on the shared chain; caller still gets the original
  return next;
}

export interface ProfileData {
  private_key: string;
  public_key: string;
  account: string;
  rest_url: string;
}

interface AptosConfigYaml {
  profiles?: Record<string, ProfileData>;
  [key: string]: unknown;
}

/**
 * Atomic write: write payload to a temp sibling → chmod the temp to 0o600
 * → rename over the target. The chmod-before-rename order eliminates a
 * window where the target file could be observable with default umask
 * perms (typically 0o644) while carrying the private key.
 */
function atomicWriteYaml(path: string, content: string): void {
  const tmpPath = `${path}.tmp.${randomUUID().slice(0, 8)}`;
  writeFileSync(tmpPath, content, { mode: 0o600 });
  chmodSync(tmpPath, 0o600); // defense in depth in case umask filtered the open mode
  renameSync(tmpPath, path);
}

/** Add the deploy's profile to ~/.aptos/config.yaml. Creates the file if absent. */
export async function addProfile(
  configPath: string,
  name: string,
  data: ProfileData
): Promise<void> {
  const configDir = dirname(configPath);
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  let yamlObj: AptosConfigYaml = {};
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf-8");
    yamlObj = (yaml.load(raw) as AptosConfigYaml) || {};
  }
  if (!yamlObj.profiles) yamlObj.profiles = {};
  yamlObj.profiles[name] = data;
  atomicWriteYaml(configPath, yaml.dump(yamlObj));
}

/**
 * Remove the deploy's profile from ~/.aptos/config.yaml. Idempotent —
 * a missing file or missing profile is a no-op. If removal leaves the
 * yaml with only an empty `profiles:` block, the whole file is unlinked
 * to preserve the "didn't exist before" semantic for the first-ever deploy.
 */
export async function removeProfile(configPath: string, name: string): Promise<void> {
  if (!existsSync(configPath)) return;
  const raw = await readFile(configPath, "utf-8");
  const yamlObj: AptosConfigYaml = (yaml.load(raw) as AptosConfigYaml) || {};
  if (!yamlObj.profiles || !(name in yamlObj.profiles)) return;
  delete yamlObj.profiles[name];

  const profilesEmpty = Object.keys(yamlObj.profiles).length === 0;
  const onlyProfilesKey =
    Object.keys(yamlObj).length === 1 && "profiles" in yamlObj;
  if (profilesEmpty && onlyProfilesKey) {
    // We created this file fresh; remove it.
    try {
      unlinkSync(configPath);
    } catch {
      // best-effort
    }
    return;
  }
  atomicWriteYaml(configPath, yaml.dump(yamlObj));
}

/**
 * Synchronous twin of `removeProfile` for the SIGINT/SIGTERM handler.
 * The event loop is dead by the time the handler runs — we cannot
 * await. Bypasses the async mutex because signal handlers are
 * sequential by construction; the operation is idempotent so a
 * benign double-delete (handler then finally, or vice versa) is fine.
 */
export function removeProfileSync(configPath: string, name: string): void {
  try {
    if (!existsSync(configPath)) return;
    const raw = readFileSync(configPath, "utf-8");
    const yamlObj: AptosConfigYaml = (yaml.load(raw) as AptosConfigYaml) || {};
    if (!yamlObj.profiles || !(name in yamlObj.profiles)) return;
    delete yamlObj.profiles[name];

    const profilesEmpty = Object.keys(yamlObj.profiles).length === 0;
    const onlyProfilesKey =
      Object.keys(yamlObj).length === 1 && "profiles" in yamlObj;
    if (profilesEmpty && onlyProfilesKey) {
      unlinkSync(configPath);
      return;
    }
    atomicWriteYaml(configPath, yaml.dump(yamlObj));
  } catch {
    // Signal handlers should never throw — swallow and exit. Better to
    // leave a stale profile (recoverable by re-running the deploy) than
    // to crash the parent process mid-shutdown.
  }
}

/**
 * Process-level signal handling. A single registered handler iterates
 * the per-deploy cleanup callbacks. Install-once because multiple
 * concurrent deploys share the same parent process — installing per
 * deploy would re-add the listener and exceed Node's max-listeners
 * warning threshold under heavy parallelism.
 */
export const cleanupCallbacks = new Set<() => void>();
let signalHandlerInstalled = false;

export function ensureSignalHandler(): void {
  if (signalHandlerInstalled) return;
  signalHandlerInstalled = true;
  const handler = (sig: NodeJS.Signals) => {
    // Synchronous cleanup of every active deploy's profile entry.
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
