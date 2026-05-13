// @ts-nocheck - This is a template file, dependencies are installed in user projects
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { setupTestFixture, type TestFixture } from "movehat/helpers";

describe("Counter Contract", () => {
  let fixture: TestFixture<'counter'>;

  before(async function () {
    this.timeout(60000); // Allow time for local node startup + deployment

    // Setup local testing environment with auto-deployment
    // This will:
    // 1. Start a local Movement blockchain node
    // 2. Generate and fund test accounts from local faucet
    // 3. Auto-deploy the counter module
    // 4. Return everything ready to use
    //
    // By default uses 'local-node' mode (full blockchain)
    // For faster tests on existing state, pass { mode: 'fork' }
    //
    // Note: Use 'as const' for type inference
    fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);

    console.log(`\n✅ Testing on local blockchain`);
    console.log(`   Deployer: ${fixture.accounts.deployer.accountAddress.toString()}`);
    console.log(`   Alice: ${fixture.accounts.alice.accountAddress.toString()}`);
    console.log(`   Bob: ${fixture.accounts.bob.accountAddress.toString()}\n`);
  });

  describe("Counter functionality", () => {
    it("should initialize counter for deployer", async () => {
      const counter = fixture.contracts.counter; // Type-safe, no `!` needed
      const deployer = fixture.accounts.deployer;

      // Initialize counter for deployer (required before get/increment)
      const tx = await counter.call(deployer, "init", []);
      console.log(`   Init transaction: ${tx.hash}`);

      // Read counter value (returns string from view function)
      const value = await counter.view<string>("get", [
        deployer.accountAddress.toString()
      ]);

      console.log(`   Counter value: ${value}`);

      // Assert the counter is 0 (note: values from view are strings)
      expect(parseInt(value)).to.equal(0);
    });

    it("should increment counter", async () => {
      const counter = fixture.contracts.counter;
      const deployer = fixture.accounts.deployer;

      // Increment the counter
      const tx = await counter.call(deployer, "increment", []);
      console.log(`   Transaction: ${tx.hash}`);

      // Read new value
      const value = await counter.view<string>("get", [
        deployer.accountAddress.toString()
      ]);

      console.log(`   New counter value: ${value}`);

      // Should be 1 now
      expect(parseInt(value)).to.equal(1);
    });

    it("alice can initialize and increment her counter", async () => {
      const counter = fixture.contracts.counter;
      const alice = fixture.accounts.alice;

      // Alice must initialize her counter first
      const initTx = await counter.call(alice, "init", []);
      console.log(`   Alice init transaction: ${initTx.hash}`);

      // Alice increments her own counter
      const tx = await counter.call(alice, "increment", []);
      console.log(`   Alice's increment transaction: ${tx.hash}`);

      // Read counter value for Alice (each user has their own counter)
      const aliceValue = await counter.view<string>("get", [
        alice.accountAddress.toString()
      ]);

      console.log(`   Alice's counter value: ${aliceValue}`);
      expect(parseInt(aliceValue)).to.equal(1);

      // Deployer's counter should still be 1 (unchanged)
      const deployerValue = await counter.view<string>("get", [
        fixture.accounts.deployer.accountAddress.toString()
      ]);

      console.log(`   Deployer's counter value: ${deployerValue}`);
      expect(parseInt(deployerValue)).to.equal(1);
    });

    it("bob can initialize and increment his counter", async () => {
      const counter = fixture.contracts.counter;
      const bob = fixture.accounts.bob;

      // Bob must initialize his counter first
      const initTx = await counter.call(bob, "init", []);
      console.log(`   Bob init transaction: ${initTx.hash}`);

      // Bob increments his own counter
      const tx = await counter.call(bob, "increment", []);
      console.log(`   Bob's increment transaction: ${tx.hash}`);

      // Read counter value for Bob (each user has their own counter)
      const bobValue = await counter.view<string>("get", [
        bob.accountAddress.toString()
      ]);

      console.log(`   Bob's counter value: ${bobValue}`);
      expect(parseInt(bobValue)).to.equal(1);
    });
  });

  after(async () => {
    // Cleanup: Stop local node
    await fixture.teardown();
  });
});
