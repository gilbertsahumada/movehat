import { describe, it, before } from "mocha";
import { expect } from "chai";
import { setupTestFixture, type TestFixture } from "movehat/helpers";

describe("Message Contract", () => {
  let fixture: TestFixture<'message'>;

  before(async function () {
    this.timeout(60000);

    fixture = await setupTestFixture(['message'] as const, []);
  });

  describe("get_message", () => {
    it("should set and retrieve a message", async function () {
      this.timeout(20000);

      const message = fixture.contracts.message;
      const deployer = fixture.accounts.deployer;
      const testMessage = "Hello, from MoveHat!";

      const txResult = await message.call(deployer, "set_message", [testMessage]);
      expect(txResult.success).to.equal(true);

      const retrievedMessage = await message.view<string>(
        "get_message",
        [deployer.accountAddress.toString()]
      );

      expect(retrievedMessage).to.equal(testMessage);
    });

    it("should update an existing message", async function () {
      this.timeout(30000);

      const message = fixture.contracts.message;
      const deployer = fixture.accounts.deployer;
      const firstMessage = "First Message";
      const secondMessage = "Updated Message";

      await message.call(deployer, "set_message", [firstMessage]);

      const txResult = await message.call(deployer, "set_message", [secondMessage]);
      expect(txResult.success).to.equal(true);

      const retrievedMessage = await message.view<string>(
        "get_message",
        [deployer.accountAddress.toString()]
      );

      expect(retrievedMessage).to.equal(secondMessage);
    });

    describe("signature", () => {
      it("should return the correct module address", async function () {
        this.timeout(10000);

        const signature = await fixture.contracts.message.view<string>("signature");

        expect(signature).to.be.a("string");
        console.log(`   Module signature: ${signature}`);
      });
    });
  });
});
