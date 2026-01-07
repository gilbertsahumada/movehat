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

  it("alice can also increment counter", async () => {
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

  after(async () => {
    await teardownTestFixture();
  });
});