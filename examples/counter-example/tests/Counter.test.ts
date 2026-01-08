import { setupTestFixture, teardownTestFixture, type TestFixture } from "movehat/helpers";
import { expect } from "chai";

describe("Counter Contract", () => {
  let fixture: TestFixture<'counter'>;

  before(async function () {
    this.timeout(60000); // Allow time for fork creation + deployment

    // Setup local testing environment with auto-deployment
    // TypeScript will infer that fixture.contracts.counter exists!
    fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);
  });

  it("should initialize with value 0", async () => {
    const counter = fixture.contracts.counter; // ✅ No need for `!` anymore
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

  after(async () => {
    await teardownTestFixture();
  });
});