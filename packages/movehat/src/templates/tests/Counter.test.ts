// @ts-nocheck - This is a template file, dependencies are installed in user projects
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { setupTestFixture, teardownTestFixture, type TestFixture } from "movehat/helpers";

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
    it("should initialize with value 0", async () => {
      const counter = fixture.contracts.counter; // Type-safe, no `!` needed
      const deployer = fixture.accounts.deployer;

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

    it("alice can also increment counter", async () => {
      const counter = fixture.contracts.counter;
      const alice = fixture.accounts.alice;

      // Alice increments her own counter
      const tx = await counter.call(alice, "increment", []);
      console.log(`   Alice's transaction: ${tx.hash}`);

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

    it("bob can also increment the counter", async () => {
      const counter = fixture.contracts.counter;
      const bob = fixture.accounts.bob;

      // Bob increments his own counter
      const tx = await counter.call(bob, "increment", []);
      console.log(`   Bob's transaction: ${tx.hash}`);

      // Read counter value for Bob (each user has their own counter)
      const bobValue = await counter.view<string>("get", [
        bob.accountAddress.toString()
      ]);

      console.log(`   Bob's counter value: ${bobValue}`);
      expect(parseInt(bobValue)).to.equal(1);
    });
  });

  after(async () => {
    // Cleanup: Stop local node and clear account pool
    await teardownTestFixture();
  });
});
