import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import {
  setupTestFixture,
  normalizeAddress,
  type TestFixture,
} from "movehat/helpers";

describe("Greeting Contract", () => {
  let fixture: TestFixture<'greeting'>;

  before(async function () {
    this.timeout(60000);

    fixture = await setupTestFixture(['greeting'] as const, ['alice', 'bob']);

    console.log(`\n✅ Testing Greeting Contract on local blockchain`);
    console.log(`   Deployer: ${fixture.accounts.deployer.accountAddress.toString()}`);
    console.log(`   Alice: ${fixture.accounts.alice.accountAddress.toString()}`);
    console.log(`   Bob: ${fixture.accounts.bob.accountAddress.toString()}\n`);
  });

  it("should set initial greeting", async () => {
    const greeting = fixture.contracts.greeting;
    const deployer = fixture.accounts.deployer;

    // Set greeting
    const tx = await greeting.call(deployer, "set_greeting", ["Hello, Movehat!"]);
    console.log(`   Transaction: ${tx.hash}`);

    // Read greeting
    const greetingText = await greeting.view<string>("get_greeting", [
      deployer.accountAddress.toString()
    ]);

    console.log(`   Greeting: "${greetingText}"`);
    expect(greetingText).to.equal("Hello, Movehat!");

    // Check count
    const count = await greeting.view<string>("get_count", [
      deployer.accountAddress.toString()
    ]);

    console.log(`   Count: ${count}`);
    expect(parseInt(count)).to.equal(1);
  });

  it("alice can set her own greeting", async () => {
    const greeting = fixture.contracts.greeting;
    const alice = fixture.accounts.alice;

    // Alice sets her greeting
    const tx = await greeting.call(alice, "set_greeting", ["Hello from Alice!"]);
    console.log(`   Alice's transaction: ${tx.hash}`);

    // Read Alice's greeting
    const aliceGreeting = await greeting.view<string>("get_greeting", [
      alice.accountAddress.toString()
    ]);

    console.log(`   Alice's greeting: "${aliceGreeting}"`);
    expect(aliceGreeting).to.equal("Hello from Alice!");

    // Check Alice's count
    const aliceCount = await greeting.view<string>("get_count", [
      alice.accountAddress.toString()
    ]);

    console.log(`   Alice's count: ${aliceCount}`);
    expect(parseInt(aliceCount)).to.equal(1);
  });

  it("should return correct module address", async () => {
    const greeting = fixture.contracts.greeting;

    const moduleAddress = await greeting.view<string>("get_module_address", []);
    console.log(`   Module address: ${moduleAddress}`);

    // The on-chain view returns the address without leading-zero padding
    // while the SDK zero-pads to 64 hex chars — normalize both sides.
    expect(normalizeAddress(moduleAddress)).to.equal(
      normalizeAddress(fixture.accounts.deployer.accountAddress.toString()),
    );
  });

  after(async () => {
    // Releases the fixture; the shared node keeps running for later specs.
    await fixture.teardown();
  });
});
