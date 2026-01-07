import type { Account } from "@aptos-labs/ts-sdk";
import type { MovehatRuntime } from "../types/runtime.js";
import type { MoveContract } from "../core/contract.js";
import { AccountManager } from "../core/AccountManager.js";
import { setupLocalTesting, stopLocalTesting } from "./setupLocalTesting.js";
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
 * @returns TestFixture with runtime, accounts, and contracts
 *
 * @example
 * ```typescript
 * import { setupTestFixture } from "movehat/helpers";
 *
 * describe("Counter Contract", () => {
 *   let fixture: TestFixture;
 *
 *   before(async function () {
 *     this.timeout(60000); // Allow time for fork + deployment
 *
 *     fixture = await setupTestFixture(['counter'], ['alice', 'bob']);
 *   });
 *
 *   it("should initialize with value 0", async () => {
 *     const counter = fixture.contracts.counter;
 *     const value = await counter.view<number>("get", [
 *       fixture.accounts.deployer.accountAddress.toString()
 *     ]);
 *
 *     expect(value).to.equal(0);
 *   });
 *
 *   it("alice can increment counter", async () => {
 *     const tx = await fixture.contracts.counter.call(
 *       fixture.accounts.alice,
 *       "increment",
 *       []
 *     );
 *
 *     expect(tx.success).to.be.true;
 *   });
 *
 *   after(async () => {
 *     await teardownTestFixture();
 *   });
 * });
 * ```
 */
export async function setupTestFixture<TModules extends readonly string[]>(
  modules: TModules,
  accountLabels: string[] = ["alice", "bob"],
  options: Partial<LocalTestOptions> = {}
): Promise<TestFixture<TModules[number]>> {
  console.log(`\n🧪 Setting up test fixture...`);
  console.log(`   Modules to deploy: ${modules.join(", ")}`);
  console.log(`   Account labels: deployer, ${accountLabels.join(", ")}\n`);

  // Ensure 'deployer' is always in the account labels
  const allLabels = ["deployer", ...accountLabels.filter((l) => l !== "deployer")];

  // Setup local testing environment with auto-deploy
  const setupOptions: LocalTestOptions = {
    ...options,
    accountLabels: allLabels,
    autoDeploy: modules, // Auto-deploy specified modules
  };

  const mh = await setupLocalTesting(setupOptions);

  // Get all labeled accounts
  const labeledAccounts = AccountManager.getLabeledAccounts();

  // Build accounts object with required accounts
  const accounts: any = {
    deployer: labeledAccounts.deployer!,
  };

  // Add other labeled accounts
  for (const label of accountLabels) {
    accounts[label] = labeledAccounts[label] || AccountManager.getOrCreateLabeled(label);
  }

  // Build contracts object - TypeScript will infer the correct type
  const contracts = {} as Record<TModules[number], MoveContract>;

  for (const moduleName of modules) {
    // Get deployed contract instance
    const deploymentAddress = mh.getDeploymentAddress(moduleName);

    if (!deploymentAddress) {
      throw new Error(
        `Module "${moduleName}" was not deployed. Check auto-deploy logs.`
      );
    }

    contracts[moduleName as TModules[number]] = mh.getContract(deploymentAddress, moduleName);
    console.log(`   ✓ Contract "${moduleName}" ready at ${deploymentAddress}`);
  }

  console.log(`\n✅ Test fixture ready!\n`);

  return {
    mh,
    accounts,
    contracts,
  } as TestFixture<TModules[number]>;
}

/**
 * Teardown test fixture and cleanup resources
 *
 * Call this in your test suite's `after` hook to properly cleanup:
 * - Stops fork server
 * - Clears account pool
 *
 * @example
 * ```typescript
 * after(async () => {
 *   await teardownTestFixture();
 * });
 * ```
 */
export async function teardownTestFixture(): Promise<void> {
  console.log(`\n🧹 Tearing down test fixture...`);

  // Stop fork server
  await stopLocalTesting();

  // Clear account pool for test isolation
  AccountManager.clearPool();

  console.log(`✓ Teardown complete\n`);
}

/**
 * Create a minimal test fixture without auto-deployment
 * Useful when you want to deploy contracts manually in tests
 *
 * @param accountLabels Account labels to create (defaults to ['alice', 'bob'])
 * @param options Optional LocalTestOptions
 * @returns Partial TestFixture (without contracts)
 *
 * @example
 * ```typescript
 * let fixture: Partial<TestFixture>;
 *
 * before(async function () {
 *   this.timeout(30000);
 *   fixture = await setupMinimalFixture(['alice', 'bob', 'charlie']);
 * });
 *
 * it("should deploy contract manually", async () => {
 *   await fixture.mh!.deployContract("counter");
 *   // ...
 * });
 * ```
 */
export async function setupMinimalFixture(
  accountLabels: string[] = ["alice", "bob"],
  options: Partial<LocalTestOptions> = {}
): Promise<Omit<TestFixture, "contracts">> {
  console.log(`\n🧪 Setting up minimal test fixture (no auto-deploy)...`);

  const allLabels = ["deployer", ...accountLabels.filter((l) => l !== "deployer")];

  const setupOptions: LocalTestOptions = {
    ...options,
    accountLabels: allLabels,
    autoDeploy: [], // No auto-deploy
  };

  const mh = await setupLocalTesting(setupOptions);

  const labeledAccounts = AccountManager.getLabeledAccounts();

  const accounts: any = {
    deployer: labeledAccounts.deployer!,
  };

  for (const label of accountLabels) {
    accounts[label] = labeledAccounts[label] || AccountManager.getOrCreateLabeled(label);
  }

  console.log(`\n✅ Minimal fixture ready!\n`);

  return {
    mh,
    accounts,
  };
}
