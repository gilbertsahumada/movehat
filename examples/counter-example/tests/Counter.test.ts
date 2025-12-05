import { getMovehat } from "movehat";
import { expect } from "chai";

describe("Counter Contract", () => {
  it("should initialize with value 0", async () => {
    // Get the Movehat Runtime Environment
    const mh = await getMovehat();

    console.log(`\n✅ Testing on ${mh.network.name}`);
    console.log(`   Account: ${mh.account.accountAddress.toString()}\n`);

    // Get counter contract
    const counter = mh.getContract(
      mh.account.accountAddress.toString(),
      "counter"
    );

    // Read counter value
    const value = await counter.view<number>("get", [
      mh.account.accountAddress.toString()
    ]);

    console.log(`   Counter value: ${value}`);

    // Assert the counter is 0
    expect(value).to.equal(0);
  });

  it("should increment counter", async () => {
    const mh = await getMovehat();

    const counter = mh.getContract(
      mh.account.accountAddress.toString(),
      "counter"
    );

    // Increment the counter
    const tx = await counter.call(mh.account, "increment", []);
    console.log(`   Transaction: ${tx.hash}`);

    // Read new value
    const value = await counter.view<number>("get", [
      mh.account.accountAddress.toString()
    ]);

    console.log(`   New counter value: ${value}`);

    // Should be 1 now
    expect(value).to.equal(1);
  });
});