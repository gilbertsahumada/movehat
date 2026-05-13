import { Harness, AccountManager } from "movehat";
import type { MoveContract } from "movehat/helpers";
import type { Account } from "@aptos-labs/ts-sdk";
import { expect } from "chai";

/**
 * Migrated to the M2 Harness API. Uses Harness.createLocal with
 * autoDeploy — same Publisher-based publish path the previous
 * setupTestFixture flow used. The sibling tests (greeting.test.ts,
 * message.test.ts) stay on setupTestFixture to demonstrate that the
 * older API continues to work side-by-side.
 *
 * For the new code-object deploy path (`harness.deployCodeObject`),
 * see scripts/deploy-counter.ts in this directory.
 */
describe("Counter Contract", () => {
  let harness: Harness;
  let counter: MoveContract;
  let counterAddr: string;
  let deployer: Account, alice: Account;

  before(async function () {
    this.timeout(60000); // Allow time for local node startup + autoDeploy

    harness = await Harness.createLocal({
      accountLabels: ["deployer", "alice", "bob"],
      autoDeploy: ["counter"],
    });

    const labeled = AccountManager.getLabeledAccounts();
    deployer = labeled.deployer!;
    alice = labeled.alice!;

    counterAddr = harness.runtime.getDeploymentAddress("counter")!;
    counter = harness.runtime.getContract(counterAddr, "counter");
  });

  it("should initialize with value 0 (via harness.runViewFunction)", async () => {
    // Demonstrate the new SDK-backed view path. Returns the raw
    // unknown[] tuple from aptos.view — destructure for singletons.
    const [value] = await harness.runViewFunction({
      function: `${counterAddr}::counter::get`,
      functionArguments: [deployer.accountAddress.toString()],
    });

    console.log(`   Counter value: ${value}`);
    expect(parseInt(value as string)).to.equal(0);
  });

  it("should increment counter", async () => {
    const tx = await counter.call(deployer, "increment", []);
    console.log(`   Transaction: ${tx.hash}`);

    const value = await counter.view<string>("get", [
      deployer.accountAddress.toString(),
    ]);

    console.log(`   New counter value: ${value}`);
    expect(parseInt(value)).to.equal(1);
  });

  it("alice can also increment counter", async () => {
    const tx = await counter.call(alice, "increment", []);
    console.log(`   Alice's transaction: ${tx.hash}`);

    const aliceValue = await counter.view<string>("get", [
      alice.accountAddress.toString(),
    ]);

    console.log(`   Alice's counter value: ${aliceValue}`);
    expect(parseInt(aliceValue)).to.equal(1);

    const deployerValue = await counter.view<string>("get", [
      deployer.accountAddress.toString(),
    ]);

    console.log(`   Deployer's counter value: ${deployerValue}`);
    expect(parseInt(deployerValue)).to.equal(1);
  });

  after(async () => {
    await harness.cleanup();
  });
});
