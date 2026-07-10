// @ts-nocheck - This is a template file, dependencies are installed in user projects
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { Harness } from "movehat";

describe("Counter Contract", () => {
  let harness;
  let counter;
  let deployer, alice, bob;

  before(async function () {
    this.timeout(60000);

    // The first fixture in the process boots one shared local node; later
    // fixtures reuse it and it shuts down automatically at process exit.
    // Each spec still gets its own accounts + deployments for isolation.
    harness = await Harness.createLocal({
      accountLabels: ["deployer", "alice", "bob"],
      autoDeploy: ["counter"],
    });

    // harness.accounts is a snapshot of the labeled accounts created
    // during Harness construction. Two `Harness.createLocal({ accountLabels:
    // ["alice"] })` calls in the same process now produce DIFFERENT
    // alice accounts (per-Harness isolation introduced in 0.2.7).
    ({ deployer, alice, bob } = harness.accounts);

    const counterAddr = harness.runtime.getDeploymentAddress("counter");
    counter = harness.runtime.getContract(counterAddr, "counter");

    console.log(`\n✅ Testing on local blockchain`);
    console.log(`   Deployer: ${deployer.accountAddress.toString()}`);
    console.log(`   Alice: ${alice.accountAddress.toString()}`);
    console.log(`   Bob: ${bob.accountAddress.toString()}\n`);
  });

  describe("Counter functionality", () => {
    it("should initialize counter for deployer", async () => {
      // Initialize counter for deployer (required before get/increment)
      const tx = await counter.call(deployer, "init", []);
      console.log(`   Init transaction: ${tx.hash}`);

      // Read counter value via harness.runViewFunction
      const [value] = await harness.runViewFunction({
        function: `${counter.moduleAddress}::counter::get`,
        functionArguments: [deployer.accountAddress.toString()],
      });

      console.log(`   Counter value: ${value}`);
      expect(parseInt(value)).to.equal(0);
    });

    it("should increment counter", async () => {
      const tx = await counter.call(deployer, "increment", []);
      console.log(`   Transaction: ${tx.hash}`);

      // counter.view is the shorter form when you already have the contract.
      const value = await counter.view<string>("get", [
        deployer.accountAddress.toString(),
      ]);

      console.log(`   New counter value: ${value}`);
      expect(parseInt(value)).to.equal(1);
    });

    it("alice can initialize and increment her counter", async () => {
      const initTx = await counter.call(alice, "init", []);
      console.log(`   Alice init transaction: ${initTx.hash}`);

      const tx = await counter.call(alice, "increment", []);
      console.log(`   Alice's increment transaction: ${tx.hash}`);

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

    it("bob can initialize and increment his counter", async () => {
      const initTx = await counter.call(bob, "init", []);
      console.log(`   Bob init transaction: ${initTx.hash}`);

      const tx = await counter.call(bob, "increment", []);
      console.log(`   Bob's increment transaction: ${tx.hash}`);

      const bobValue = await counter.view<string>("get", [
        bob.accountAddress.toString(),
      ]);

      console.log(`   Bob's counter value: ${bobValue}`);
      expect(parseInt(bobValue)).to.equal(1);
    });
  });

  after(async () => {
    // harness.cleanup() poisons the harness — any further method call
    // (other than cleanup itself) throws HarnessDisposedError
    // synchronously. The shared node keeps running for later specs.
    await harness.cleanup();
  });
});
