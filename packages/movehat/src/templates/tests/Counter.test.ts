import { describe, it } from "mocha";
import { expect } from "chai";
import { Harness } from "movehat";

async function createFixture() {
  const harness = await Harness.createLocal({
    accountLabels: ["deployer", "alice", "bob"],
    autoDeploy: ["counter"],
  });
  const { deployer, alice, bob } = harness.accounts;
  const counterAddress = harness.runtime.getDeploymentAddress("counter");
  if (!deployer || !alice || !bob || !counterAddress) {
    await harness.cleanup();
    throw new Error("Counter fixture did not create the expected accounts and deployment");
  }
  return {
    harness,
    counter: harness.runtime.getContract(counterAddress, "counter"),
    deployer,
    alice,
    bob,
  };
}

describe("Counter Contract", () => {
  it("initializes a counter at zero", async function () {
    this.timeout(60_000);
    const fixture = await createFixture();
    try {
      await fixture.counter.call(fixture.deployer, "init", []);
      const value = await fixture.counter.view<string>("get", [
        fixture.deployer.accountAddress.toString(),
      ]);
      expect(Number(value)).to.equal(0);
    } finally {
      await fixture.harness.cleanup();
    }
  });

  it("increments without depending on another test", async function () {
    this.timeout(60_000);
    const fixture = await createFixture();
    try {
      await fixture.counter.call(fixture.deployer, "increment", []);
      const value = await fixture.counter.view<string>("get", [
        fixture.deployer.accountAddress.toString(),
      ]);
      expect(Number(value)).to.equal(1);
    } finally {
      await fixture.harness.cleanup();
    }
  });

  it("isolates counters owned by different accounts", async function () {
    this.timeout(60_000);
    const fixture = await createFixture();
    try {
      await fixture.counter.call(fixture.alice, "increment", []);
      await fixture.counter.call(fixture.bob, "increment", []);
      await fixture.counter.call(fixture.bob, "increment", []);

      const aliceValue = await fixture.counter.view<string>("get", [
        fixture.alice.accountAddress.toString(),
      ]);
      const bobValue = await fixture.counter.view<string>("get", [
        fixture.bob.accountAddress.toString(),
      ]);
      expect(Number(aliceValue)).to.equal(1);
      expect(Number(bobValue)).to.equal(2);
    } finally {
      await fixture.harness.cleanup();
    }
  });
});
