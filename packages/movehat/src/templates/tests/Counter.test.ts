// @ts-nocheck - This is a template file, dependencies are installed in user projects
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { setupTestFixture, teardownTestFixture, type TestFixture } from "movehat/helpers";

describe("Counter Contract", () => {
  let fixture: TestFixture<'counter'>;

  before(async function () {
    this.timeout(60000); // Allow time for fork creation + deployment

    // Setup local testing environment with auto-deployment
    // This will:
    // 1. Create a local fork of testnet
    // 2. Start a fork server
    // 3. Generate and fund test accounts
    // 4. Auto-deploy the counter module
    // 5. Return everything ready to use
    //
    // Note: Use 'as const' for type inference
    fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);

    console.log(`\n✅ Testing on local fork`);
    console.log(`   Deployer: ${fixture.accounts.deployer.accountAddress.toString()}`);
    console.log(`   Alice: ${fixture.accounts.alice.accountAddress.toString()}`);
    console.log(`   Bob: ${fixture.accounts.bob.accountAddress.toString()}\n`);
  });

  describe("Counter functionality", () => {
    it("should initialize with value 0", async () => {
      const counter = fixture.contracts.counter; // Type-safe, no `!` needed
      const deployer = fixture.accounts.deployer;

      // Read counter value
      const value = await counter.view<number>("get", [
        deployer.accountAddress.toString()
      ]);

      console.log(`   Counter value: ${value}`);

      // Assert the counter is 0
      expect(value).to.equal(0);
    });

    it("should increment counter", async () => {
      const counter = fixture.contracts.counter;
      const deployer = fixture.accounts.deployer;

      // Increment the counter
      const tx = await counter.call(deployer, "increment", []);
      console.log(`   Transaction: ${tx.hash}`);

      // Read new value
      const value = await counter.view<number>("get", [
        deployer.accountAddress.toString()
      ]);

      console.log(`   New counter value: ${value}`);

      // Should be 1 now
      expect(value).to.equal(1);
    });

    it("alice can increment the counter", async () => {
      const counter = fixture.contracts.counter;
      const alice = fixture.accounts.alice;

      // Alice increments
      const tx = await counter.call(alice, "increment", []);
      console.log(`   Alice's transaction: ${tx.hash}`);

      // Read counter value for deployer (should be 2 now)
      const deployerValue = await counter.view<number>("get", [
        fixture.accounts.deployer.accountAddress.toString()
      ]);

      console.log(`   Counter value after Alice's increment: ${deployerValue}`);
      expect(deployerValue).to.equal(2);
    });

    it("bob can also increment the counter", async () => {
      const counter = fixture.contracts.counter;
      const bob = fixture.accounts.bob;

      // Bob increments
      const tx = await counter.call(bob, "increment", []);
      console.log(`   Bob's transaction: ${tx.hash}`);

      // Read counter value for deployer (should be 3 now)
      const deployerValue = await counter.view<number>("get", [
        fixture.accounts.deployer.accountAddress.toString()
      ]);

      console.log(`   Counter value after Bob's increment: ${deployerValue}`);
      expect(deployerValue).to.equal(3);
    });
  });

  after(async () => {
    // Cleanup: Stop fork server and clear account pool
    await teardownTestFixture();
  });
});
