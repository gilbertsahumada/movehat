import type { Account } from "@aptos-labs/ts-sdk";
import type { MovehatRuntime } from "../types/runtime.js";
import type { MoveContract } from "../core/contract.js";
import { AccountManager } from "../core/AccountManager.js";
import { setupLocalTesting } from "./setupLocalTesting.js";
import { logger } from "../ui/index.js";
import type { LocalTestOptions } from "../types/config.js";

/**
 * Test fixture with pre-configured accounts and contracts
 *
 * @template TModules - Union type of module names for type-safe contract access
 */
export interface TestFixture<TModules extends string = string> {
  /** Movehat runtime instance */
  mh: MovehatRuntime;

  /** Named accounts (deployer, alice, bob, etc.) */
  accounts: {
    deployer: Account;
    alice: Account;
    bob: Account;
    [key: string]: Account;
  };

  /** Deployed contracts by module name - type-safe based on modules parameter */
  contracts: Record<TModules, MoveContract>;

  /**
   * Stop the local node / fork server this fixture started.
   *
   * Does **not** clear the shared `AccountManager` pool — clearing it
   * would break parallel `setupTestFixture` invocations that share the
   * pool. The pool grows for the lifetime of the process; the process
   * exit reclaims it.
   */
  teardown: () => Promise<void>;
}

/**
 * Setup a complete test fixture with local fork, accounts, and deployed contracts
 *
 * This is the recommended way to setup tests in movehat. It provides:
 * - Local fork server (no testnet required)
 * - Pre-funded labeled accounts
 * - Auto-deployment of specified modules
 * - Contract instances ready to use
 *
 * @param modules Array of module names to auto-deploy
 * @param accountLabels Optional array of account labels (defaults to ['alice', 'bob'])
 * @param options Optional LocalTestOptions for advanced configuration
 * @returns TestFixture with runtime, accounts, contracts, and a teardown closure
 *
 * @example
 * ```typescript
 * import { setupTestFixture, type TestFixture } from "movehat/helpers";
 *
 * describe("Counter Contract", () => {
 *   let fixture: TestFixture<"counter">;
 *
 *   before(async function () {
 *     this.timeout(60000);
 *     fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);
 *   });
 *
 *   after(async () => {
 *     await fixture.teardown();
 *   });
 *
 *   it("alice can increment", async () => {
 *     const tx = await fixture.contracts.counter.call(
 *       fixture.accounts.alice, "increment", []
 *     );
 *     expect(tx.success).to.be.true;
 *   });
 * });
 * ```
 */
export async function setupTestFixture<TModules extends readonly string[]>(
  modules: TModules,
  accountLabels: string[] = ["alice", "bob"],
  options: Partial<LocalTestOptions> = {}
): Promise<TestFixture<TModules[number]>> {
  logger.newline();
  logger.step("Setting up test fixture...");
  logger.plain(`   Modules to deploy: ${modules.join(", ")}`);
  logger.plain(`   Account labels: deployer, ${accountLabels.join(", ")}`);
  logger.newline();

  const allLabels = ["deployer", ...accountLabels.filter((l) => l !== "deployer")];

  const setupOptions: LocalTestOptions = {
    ...options,
    accountLabels: allLabels,
    autoDeploy: modules,
  };

  const ctx = await setupLocalTesting(setupOptions);
  const mh = ctx.runtime;

  const labeledAccounts = AccountManager.getLabeledAccounts();

  // any: TestFixture.accounts has a structural shape with required
  // `deployer/alice/bob` plus a `[key: string]: Account` index. The
  // builder fills the index dynamically; typing this as the exact
  // intersection would require a generic over `accountLabels` and
  // produce noisy errors for the dynamic key assignment below.
  const accounts: any = {
    // non-null: setupLocalTesting → setupWithLocalNode/Fork unconditionally
    // funds the deployer account via accountLabels[0]; deployer is always
    // first by construction at L93 above.
    deployer: labeledAccounts.deployer!,
  };

  for (const label of accountLabels) {
    accounts[label] = labeledAccounts[label] || AccountManager.getOrCreateLabeled(label);
  }

  const contracts = {} as Record<TModules[number], MoveContract>;

  for (const moduleName of modules) {
    const deploymentAddress = mh.getDeploymentAddress(moduleName);

    if (!deploymentAddress) {
      throw new Error(
        `Module "${moduleName}" was not deployed. Check auto-deploy logs.`
      );
    }

    contracts[moduleName as TModules[number]] = mh.getContract(deploymentAddress, moduleName);
    logger.success(`Contract "${moduleName}" ready at ${deploymentAddress}`, 2);
  }

  logger.newline();
  logger.success("Test fixture ready!");
  logger.newline();

  return {
    mh,
    accounts,
    contracts,
    teardown: ctx.teardown,
  } as TestFixture<TModules[number]>;
}

/**
 * Create a minimal test fixture without auto-deployment
 * Useful when you want to deploy contracts manually in tests
 *
 * @param accountLabels Account labels to create (defaults to ['alice', 'bob'])
 * @param options Optional LocalTestOptions
 * @returns Partial TestFixture (without contracts) plus a teardown closure
 */
export async function setupMinimalFixture(
  accountLabels: string[] = ["alice", "bob"],
  options: Partial<LocalTestOptions> = {}
): Promise<Omit<TestFixture, "contracts">> {
  logger.newline();
  logger.step("Setting up minimal test fixture (no auto-deploy)...");

  const allLabels = ["deployer", ...accountLabels.filter((l) => l !== "deployer")];

  const setupOptions: LocalTestOptions = {
    ...options,
    accountLabels: allLabels,
    autoDeploy: [],
  };

  const ctx = await setupLocalTesting(setupOptions);
  const mh = ctx.runtime;

  const labeledAccounts = AccountManager.getLabeledAccounts();

  // any: see setupTestFixture above — same dynamic-key builder pattern.
  const accounts: any = {
    // non-null: deployer is unconditionally added to allLabels at L156 above.
    deployer: labeledAccounts.deployer!,
  };

  for (const label of accountLabels) {
    accounts[label] = labeledAccounts[label] || AccountManager.getOrCreateLabeled(label);
  }

  logger.newline();
  logger.success("Minimal fixture ready!");
  logger.newline();

  return {
    mh,
    accounts,
    teardown: ctx.teardown,
  };
}
