import { Harness } from "movehat";

async function main() {
  console.log("🚀 Deploying Counter contract...\n");

  // Hardhat-style Harness — the primary public API.
  // createLive binds to a real running network (testnet / mainnet / a
  // custom one defined in movehat.config.ts). No local process spawned.
  const network = process.env.MOVEHAT_NETWORK ?? "testnet";
  const harness = await Harness.createLive(network);
  try {
    console.log(`✅ Runtime initialized on ${harness.runtime.network.name}`);
    console.log(`   Account: ${harness.runtime.account.accountAddress.toString()}`);
    console.log(`   RPC: ${harness.runtime.network.rpc}\n`);

    // Deploy as a code object via `movement move deploy-object`. If the
    // Move.toml's named address differs from the module identifier
    // (e.g. `module my_pkg::counter` with `[addresses] my_pkg = "_"`),
    // pass `addressName: "my_pkg"` in addition to `moduleName: "counter"`.
    //
    // To redeploy an existing record, set MH_CLI_REDEPLOY=true.
    const deployment = await harness.deployCodeObject({
      moduleName: "counter",
    });

    console.log(`\n✅ Module deployed at: ${deployment.address}::counter`);
    if (deployment.txHash) {
      console.log(`   Transaction: ${deployment.txHash}`);
    }

    // Interact with the freshly deployed module via the runtime helper.
    const counter = harness.runtime.getContract(deployment.address, "counter");

    console.log("\n📝 Incrementing counter...");
    const txResult = await counter.call(harness.runtime.account, "increment", []);
    console.log(`✅ Transaction hash: ${txResult.hash}`);

    // Use harness.runViewFunction directly when you have a fully
    // qualified function id; counter.view<T>(...) is the shorter form.
    const [value] = await harness.runViewFunction({
      function: `${deployment.address}::counter::get`,
      functionArguments: [harness.runtime.account.accountAddress.toString()],
    });
    console.log(`\n📊 Counter value: ${value}`);
  } finally {
    // Always release the Harness — cleanup() is idempotent and safe to
    // call on a `createLive` instance even though no local process was
    // spawned (it just flips the use-after-cleanup poison flag).
    await harness.cleanup();
  }
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error?.message || error);
  process.exit(1);
});
