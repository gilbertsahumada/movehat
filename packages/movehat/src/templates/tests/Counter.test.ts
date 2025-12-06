import { describe, it, before } from "mocha";
import { expect } from "chai";
import { getMovehat, type MovehatRuntime } from "movehat";
import type { MoveContract } from "movehat/helpers";
import { assertTransactionSuccess } from "movehat/helpers";

describe("Counter Contract", () => {
  let mh: MovehatRuntime;
  let counter: MoveContract;

  before(async function () {
    this.timeout(30000);

    // Initialize Movehat Runtime Environment
    mh = await getMovehat();

    console.log(`\n✅ Testing on ${mh.network.name}`);
    console.log(`   Account: ${mh.account.accountAddress.toString()}\n`);

    // Get counter contract instance
    counter = mh.getContract(
      mh.account.accountAddress.toString(),
      "counter"
    );
  });

  describe("Counter functionality", () => {
    it("should initialize counter", async function () {
      this.timeout(30000);

      const txResult = await counter.call(mh.account, "init", []);
      assertTransactionSuccess(txResult);

      const value = await counter.view<number>("get", [
        mh.account.accountAddress.toString()
      ]);

      expect(value).to.equal(0);
      console.log(`   ✓ Counter initialized with value: ${value}`);
    });

    it("should increment counter", async function () {
      this.timeout(30000);

      const initialValue = await counter.view<number>("get", [
        mh.account.accountAddress.toString()
      ]);

      const txResult = await counter.call(mh.account, "increment", []);
      assertTransactionSuccess(txResult);

      const newValue = await counter.view<number>("get", [
        mh.account.accountAddress.toString()
      ]);

      expect(newValue).to.equal(initialValue + 1);
      console.log(`   ✓ Counter incremented: ${initialValue} → ${newValue}`);
    });
  });
});