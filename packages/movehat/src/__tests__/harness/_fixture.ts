import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _resetConfigCache } from "../../core/config.js";

/**
 * Shared test fixture for Harness tests.
 *
 * Six test files in `__tests__/harness/` all needed the same setup
 * boilerplate (~30 LoC each) before this helper landed: tmpdir for
 * cwd, write a `movehat.config.js`, write a minimal Move package
 * (`move/Move.toml` + `move/sources/dummy.move`), chdir, reset the
 * mtime-based config cache, manage HOME for tests that exercise
 * `~/.aptos/config.yaml` profile management. Extracted as a single
 * helper to eliminate the drift surface across siblings.
 *
 * The defaults match the most common test shape: a single `testnet`
 * network and no HOME management. Tests that need more (a `custom`
 * network for switching, an isolated HOME for profile tests) opt in
 * via the options.
 *
 * @internal — not exported from `src/index.ts`. Test-only.
 */

/**
 * Additional networks to merge into the fixture's `movehat.config.js`.
 * Keyed by network name. Each network needs `url` + `chainId` at
 * minimum; pass `accounts` when the test exercises a code path that
 * requires explicit account configuration (e.g. mainnet-like security
 * checks in `resolveNetworkConfig`).
 */
export interface ExtraNetwork {
  url: string;
  chainId: string;
  accounts?: string[];
}

export interface HarnessTestFixtureOptions {
  /** Additional networks merged on top of the default `testnet` entry. */
  extraNetworks?: Record<string, ExtraNetwork>;

  /**
   * When `true`, manage a separate `process.env.HOME` directory for
   * the test. Used by tests that exercise `~/.aptos/config.yaml`
   * profile writes (codeObject.* and script.* test suites).
   */
  withTmpHome?: boolean;
}

export interface HarnessTestFixture {
  /** Fresh per-test cwd. The test is chdir'd here. */
  tmpCwd: string;
  /** Fresh per-test HOME, only set when `withTmpHome: true`. */
  tmpHome?: string;
  /** Restore cwd + HOME, remove the tmp dirs, and reset config cache. */
  teardown: () => void;
}

/**
 * Build a fresh per-test fixture. Call from `beforeEach`, capture the
 * returned object, and call `fixture.teardown()` in `afterEach`.
 */
export function setupHarnessTestFixture(
  options: HarnessTestFixtureOptions = {}
): HarnessTestFixture {
  const tmpCwd = mkdtempSync(join(tmpdir(), "movehat-harness-test-"));
  const tmpHome = options.withTmpHome
    ? mkdtempSync(join(tmpdir(), "movehat-harness-home-"))
    : undefined;

  // Build the network map. Default `testnet` + caller's extras.
  const networks: Record<string, ExtraNetwork> = {
    testnet: {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet",
    },
    ...(options.extraNetworks ?? {}),
  };

  writeFileSync(
    join(tmpCwd, "movehat.config.js"),
    `export default {
  defaultNetwork: "testnet",
  networks: ${JSON.stringify(networks, null, 2)}
};
`
  );

  // Minimal Move package — `extractNamedAddresses` reads from
  // `<moveDir>/sources/*.move`; an empty file yields an empty Set.
  const moveDir = join(tmpCwd, "move");
  mkdirSync(join(moveDir, "sources"), { recursive: true });
  writeFileSync(
    join(moveDir, "Move.toml"),
    `[package]
name = "dummy"
version = "0.0.1"

[addresses]
`
  );
  writeFileSync(join(moveDir, "sources", "dummy.move"), "// intentionally empty\n");

  const origCwd = process.cwd();
  const origHome = process.env.HOME;
  process.chdir(tmpCwd);
  if (tmpHome !== undefined) process.env.HOME = tmpHome;
  _resetConfigCache();

  const teardown = () => {
    try {
      process.chdir(origCwd);
    } finally {
      if (options.withTmpHome) {
        if (origHome === undefined) delete process.env.HOME;
        else process.env.HOME = origHome;
        if (tmpHome !== undefined && existsSync(tmpHome)) {
          rmSync(tmpHome, { recursive: true, force: true });
        }
      }
      if (existsSync(tmpCwd)) {
        rmSync(tmpCwd, { recursive: true, force: true });
      }
      _resetConfigCache();
    }
  };

  const fixture: HarnessTestFixture = { tmpCwd, teardown };
  if (tmpHome !== undefined) fixture.tmpHome = tmpHome;
  return fixture;
}
