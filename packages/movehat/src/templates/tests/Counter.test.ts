import { describe, it, before } from "mocha";
import { expect } from "chai";
import { setupTestEnvironment, type TestEnvironment } from "../node_modules/movehat/dist/helpers/setup.js";
import { getContract, type MoveContract } from "../node_modules/movehat/dist/helpers/contract.js";
import { assertTransactionSuccess } from "../node_modules/movehat/dist/helpers/assertions.js";

describe("Counter Contract", () => {
  let env: TestEnvironment;
  let counter: MoveContract;

  before(async function () {
    this.timeout(30000);
    
    env = await setupTestEnvironment();
    
    counter = getContract(
      env.aptos,
      env.account.accountAddress.toString(),
      "counter"
    );
  });

  describe("Counter functionality", () => {
    it("should initialize counter", async function () {
      this.timeout(30000);

      const txResult = await counter.call(env.account, "init", []);
      assertTransactionSuccess(txResult);

      const value = await counter.view<number>("get", [
        env.account.accountAddress.toString()
      ]);

      expect(value).to.equal(0);
    });

    it("should increment counter", async function () {
      this.timeout(30000);

      const initialValue = await counter.view<number>("get", [
        env.account.accountAddress.toString()
      ]);

      const txResult = await counter.call(env.account, "increment", []);
      assertTransactionSuccess(txResult);

      const newValue = await counter.view<number>("get", [
        env.account.accountAddress.toString()
      ]);

      expect(newValue).to.equal(initialValue + 1);
    });
  });
});