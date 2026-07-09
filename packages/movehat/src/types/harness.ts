import type { DeploymentInfo } from "../core/deployments.js";
import type { ChildProcessAdapter } from "../utils/childProcessAdapter.js";

/**
 * Options for `harness.deployCodeObject(options)`.
 *
 * Wraps `movement move deploy-object`. The Movement CLI derives the
 * destination object address from the signing account; that address is
 * bound to `moduleName` (passed as `--address-name`) at compile time.
 * Callers retrieve the resulting object address via the returned
 * `CodeObjectInfo.address`.
 */
export interface DeployCodeObjectOptions {
  /**
   * Logical module identifier (the `name` part of `module addr::name`).
   * Used as the persistence key (`deployments/{network}/{moduleName}.json`)
   * and as the `name` arg you'd pass to `runtime.getContract(addr, name)`
   * after deployment.
   *
   * If `addressName` is omitted, `moduleName` is also used as the CLI's
   * `--address-name` flag (correct when the Move.toml's named address
   * matches the module identifier). For packages where they differ —
   * e.g. `module hello_blockchain::counter` (named address
   * `hello_blockchain`, module `counter`) — set `addressName` explicitly.
   */
  moduleName: string;

  /**
   * Move.toml named address that the derived object address binds to
   * at compile time (the `--address-name` flag of `move deploy-object`).
   *
   * Defaults to `moduleName`. Set this when the Move.toml's named
   * address differs from the on-chain module identifier:
   *
   * ```ts
   * // Move source: `module hello_blockchain::counter`
   * // Move.toml:   `[addresses] hello_blockchain = "_"`
   * await harness.deployCodeObject({
   *   moduleName: "counter",            // for getContract + save key
   *   addressName: "hello_blockchain",  // for --address-name
   * });
   * ```
   */
  addressName?: string;

  /**
   * Extra named-address overrides merged on top of the addresses
   * auto-detected from `<packageDir>/sources/**.move`. Values here win
   * for the matching keys; auto-detected names not present here are
   * still pinned to the deployer address (Publisher convention).
   */
  namedAddresses?: Record<string, string>;

  /**
   * Path to the Move package. Defaults to `config.moveDir` from the
   * harness's runtime config (usually `./move`).
   */
  packageDir?: string;

  /**
   * Artifact set written into the on-chain package. Mirrors the CLI
   * flag. Defaults to `'sparse'` (the Movement CLI default).
   */
  includedArtifacts?: "none" | "sparse" | "all";

  /**
   * Skip the already-deployed check and overwrite the deployment record.
   * Falls back to the `MH_CLI_REDEPLOY=true` environment variable when
   * omitted.
   */
  redeploy?: boolean;

  /**
   * Test-only override for the child-process adapter. Production callers
   * leave this undefined so the default spawn-based adapter is used.
   * @internal
   */
  adapter?: ChildProcessAdapter;
}

/**
 * Options for `harness.upgradeCodeObject(options)`.
 *
 * Wraps `movement move upgrade-object`. The object must already exist
 * on-chain at `objectAddress` and have been deployed previously (typically
 * via `deployCodeObject`).
 */
export interface UpgradeCodeObjectOptions
  extends Omit<DeployCodeObjectOptions, "redeploy"> {
  /** Address of the existing code object to upgrade. Required. */
  objectAddress: string;
}

/**
 * Result of `deployCodeObject` / `upgradeCodeObject`.
 *
 * Today this is structurally identical to {@link DeploymentInfo} — the
 * `address` field holds the derived **object address** (the value
 * callers pass to `runtime.getContract(...)` to interact with the
 * modules), and `deployer` is the signing account.
 *
 * The alias exists so future iterations can layer additional fields
 * (e.g. an explicit `kind: 'code-object' | 'publish'` discriminator)
 * without churning every callsite.
 */
export type CodeObjectInfo = DeploymentInfo;

/**
 * Options for `harness.runViewFunction(options)`.
 *
 * Delegates to the Aptos SDK's `aptos.view(...)` — no CLI invocation,
 * no profile management. Works on `createLocal`, `createFork`, and
 * `createLive` harnesses (view functions are read-only).
 */
export interface RunViewFunctionOptions {
  /**
   * Fully qualified Move function id, e.g. `0xCAFE::counter::get`.
   */
  function: string;

  /**
   * Move type-tag arguments, e.g. `['0x1::aptos_coin::AptosCoin']`.
   */
  typeArguments?: string[];

  /**
   * Move function arguments. SDK-validated at the boundary; pass values
   * matching the Move function signature (strings for `address`,
   * numbers / bigints for `u8`-`u256`, booleans, etc.).
   */
  functionArguments?: unknown[];
}

/**
 * Options for `harness.runMoveScript(options)`.
 *
 * Wraps `movement move run-script`. The CLI handles compilation
 * inline when given a `.move` source; the user can also pass a
 * pre-compiled `.mv` bytecode file.
 *
 * Not available on fork-mode harnesses (forks are read-only).
 */
export interface RunMoveScriptOptions {
  /**
   * Path to the Move script. Extension determines the CLI flag:
   *   - `.move` → `--script-path` (CLI auto-compiles)
   *   - `.mv` → `--compiled-script-path` (user pre-compiled)
   * Other extensions throw synchronously before any CLI call.
   */
  scriptPath: string;

  /**
   * CLI-formatted typed arguments. Movement CLI expects each arg
   * prefixed by its Move type, e.g. `'address:0x1'`, `'u8:42'`,
   * `'bool:true'`, `'string:hello'`. See
   * `movement move run-script --help` for the full grammar.
   */
  args?: string[];

  /**
   * Type-tag arguments for generic scripts, e.g.
   * `['0x1::aptos_coin::AptosCoin']`.
   */
  typeArgs?: string[];

  /**
   * Optional working directory for compilation. Most callers leave
   * this undefined — the CLI uses the script's parent directory.
   */
  packageDir?: string;

  /**
   * Test-only override for the child-process adapter.
   * @internal
   */
  adapter?: ChildProcessAdapter;
}

/**
 * Result of `harness.runMoveScript`.
 *
 * Always carries `txHash` (parser throws if it can't extract one).
 * `success` and `vmStatus` are best-effort: parsed from the CLI's
 * JSON `Result` block when present, `undefined` if the parser misses.
 */
export interface MoveScriptResult {
  txHash: string;
  success?: boolean;
  vmStatus?: string;
}
