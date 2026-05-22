import { Harness } from "movehat";
import type { MoveContract } from "movehat/helpers";
import type { Account } from "@aptos-labs/ts-sdk";
import { expect } from "chai";

/**
 * Uses the Harness API: Harness.createLocal with autoDeploy. Sibling
 * tests (greeting.test.ts, message.test.ts) use setupTestFixture to
 * demonstrate both surfaces in the same project.
 *
 * For the code-object deploy path (`harness.deployCodeObject`), see
 * scripts/deploy-counter.ts in this directory.
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

    // harness.accounts snapshots the labeled accounts at construction
    // time (per-Harness isolation introduced in 0.2.7). Non-null
    // assertions are needed because the example's tsconfig enables
    // noUncheckedIndexedAccess.
    deployer = harness.accounts.deployer!;
    alice = harness.accounts.alice!;

    counterAddr = harness.runtime.getDeploymentAddress("counter")!;
    counter = harness.runtime.getContract(counterAddr, "counter");
  });

  it("should initialize with value 0 (via harness.runViewFunction)", async () => {
    // aptos.view returns unknown[] even for single-value views
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
