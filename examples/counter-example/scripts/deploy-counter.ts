import { Harness } from "movehat";
import config from "../movehat.config.js";

/**
 * Canonical example of `harness.deployCodeObject` against a Move
 * package where the Move.toml's named address differs from the
 * module identifier:
 *
 *   move/Move.toml:    [addresses] hello_blockchain = "_"
 *   move/sources/...:  module hello_blockchain::counter { ... }
 *
 * `--address-name` must be `hello_blockchain` (the Move.toml slot),
 * but `moduleName` stays `counter` (the on-chain module identifier
 * + the persistence key + the `runtime.getContract(addr, "counter")`
 * argument). The `addressName` option carries that distinction.
 */
async function main() {
  console.log("🚀 Deploying Counter contract...\n");

  const network =
    process.env.MH_CLI_NETWORK ??
    process.env.MOVEHAT_NETWORK ??
    process.env.MH_DEFAULT_NETWORK ??
    config.defaultNetwork ??
    "local";
  const isLocal = network === "local" || network === "movelite";
  const harness = isLocal
    ? await Harness.createLocal({
        ...(network === "movelite" ? { useMovelite: true } : {}),
        autoDeploy: ["counter"],
      })
    : await Harness.createLive(network);
  try {
    console.log(`✅ Runtime initialized on ${harness.runtime.network.name}`);
    console.log(`   Account: ${harness.runtime.account.accountAddress.toString()}`);
    console.log(`   RPC: ${harness.runtime.network.rpc}\n`);

    const deployment = isLocal
      ? harness.runtime.getDeployment("counter")
      : await harness.deployCodeObject({
          moduleName: "counter",
          addressName: "hello_blockchain",
        });
    if (!deployment) {
      throw new Error("Local counter deployment record was not created");
    }

    console.log(`\n✅ Module deployed at: ${deployment.address}::counter`);
    if (deployment.txHash) {
      console.log(`   Transaction: ${deployment.txHash}`);
    }

    const counter = harness.runtime.getContract(deployment.address, "counter");

    console.log("\n📝 Incrementing counter...");
    const txResult = await counter.call(harness.runtime.account, "increment", []);
    console.log(`✅ Transaction hash: ${txResult.hash}`);

    const [value] = await harness.runViewFunction({
      function: `${deployment.address}::counter::get`,
      functionArguments: [harness.runtime.account.accountAddress.toString()],
    });
    console.log(`\n📊 Counter value: ${value}`);
  } finally {
    await harness.cleanup();
  }
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error?.message || error);
  process.exit(1);
});
