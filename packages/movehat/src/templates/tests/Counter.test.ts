import { describe, it, before } from "mocha";
import { expect } from "chai";
import { getMovehat, type MovehatRuntime } from "movehat";

describe("Counter Contract", () => {
  let mh: MovehatRuntime;
  let contractAddress: string;

  before(async function () {
    this.timeout(30000);

    // Initialize Movehat Runtime Environment
    // Uses devnet by default - no local setup required
    mh = await getMovehat();

    contractAddress = mh.account.accountAddress.toString();

    console.log(`\nTesting on ${mh.network.name}`);
    console.log(`Account: ${contractAddress}\n`);
  });

  describe("Counter functionality", () => {
    it("should initialize counter using simulation", async function () {
      this.timeout(30000);

      // Build transaction
      const transaction = await mh.aptos.transaction.build.simple({
        sender: mh.account.accountAddress,
        data: {
          function: `${contractAddress}::counter::init`,
          functionArguments: []
        }
      });

      // Simulate transaction (no gas cost, instant)
      const [simulation] = await mh.aptos.transaction.simulate.simple({
        signerPublicKey: mh.account.publicKey,
        transaction
      });

      // Verify simulation succeeded
      expect(simulation.success).to.be.true;
      console.log(`Counter init simulated successfully`);
      console.log(`Gas used: ${simulation.gas_used}`);
    });

    it("should increment counter using simulation", async function () {
      this.timeout(30000);

      // Build increment transaction
      const transaction = await mh.aptos.transaction.build.simple({
        sender: mh.account.accountAddress,
        data: {
          function: `${contractAddress}::counter::increment`,
          functionArguments: []
        }
      });

      // Simulate transaction
      const [simulation] = await mh.aptos.transaction.simulate.simple({
        signerPublicKey: mh.account.publicKey,
        transaction
      });

      // Verify simulation succeeded
      expect(simulation.success).to.be.true;
      console.log(`Counter increment simulated successfully`);
      console.log(`Gas used: ${simulation.gas_used}`);
    });
  });
});