import { describe, it, before } from "mocha";
import { expect } from "chai";
import { setupTestEnvironment, type TestEnvironment } from "./helpers/setup.js";
import { getContract, MoveContract } from "./helpers/contract.js";
import { assertTransactionSuccess } from "./helpers/assertion.js";

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

      assertTransactionSuccess(txResult);

      const retrievedMessage = await messageContract.view<string>(
        "get_message",
        [env.account.accountAddress.toString()]
      );

      expect(retrievedMessage).to.equal(testMessage);
    });

    it("should update an existing message", async function () {
      this.timeout(30000);

      const firstMessage = "First Message";
      const secondMessage = "Updated Message";

      await messageContract.call(env.account, "set_message", [firstMessage]);

      const txResult = await messageContract.call(env.account, "set_message", [
        secondMessage,
      ]);

      assertTransactionSuccess(txResult);

      const retrievedMessage = await messageContract.view<string>(
        "get_message",
        [env.account.accountAddress.toString()]
      );

      expect(retrievedMessage).to.equal(secondMessage);
    });

    describe("signature", () => {
      it("should return the correct module address", async function () {
        this.timeout(10000);

        const signature = await messageContract.view<string>("signature");

        expect(signature).to.be.a("string");
        console.log(`Module signature: ${signature}`);
      });
    });
  });
});
