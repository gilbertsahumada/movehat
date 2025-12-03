import { describe, it, before } from "mocha";
import { expect } from "chai";
import { setupTestEnvironment, type TestEnvironment } from "./setup.js";
import { getContract, MoveContract } from "./contract.js";
import { assertTransactionSuccess } from "./assertion.js";

describe("Message Contract", () => {
  let env: TestEnvironment;
  let messageContract: MoveContract;

  before(async function () {
    this.timeout(30000); // Increase timeout for setup

    env = await setupTestEnvironment();

    messageContract = getContract(env.aptos, env.config.account, "message");
  });

  describe("get_message", () => {
    it("should set and retieve a message", async function () {
      this.timeout(20000);

      const testMessage = "Hello, from MoveHat!";

      const txResult = await messageContract.call(env.account, "set_message", [
        testMessage,
      ]);
    });
  });
});
