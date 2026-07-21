import { Harness } from "movehat";
import config from "../movehat.config.js";

async function main() {
  console.log("🚀 Deploying Counter contract...\n");

  // Safe by default: the generated project runs against a disposable local
  // chain. Set MOVEHAT_NETWORK=testnet/mainnet/custom only when you intend to
  // submit a public-network transaction and have configured PRIVATE_KEY.
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
        // Movehat selects the SDK publish path when Movelite is the backend,
        // avoiding assumptions made by `movement move deploy-object` about
        // full-node REST response fields.
        autoDeploy: ["counter"],
      })
    : await Harness.createLive(network);
  try {
    console.log(`✅ Runtime initialized on ${harness.runtime.network.name}`);
    console.log(`   Account: ${harness.runtime.account.accountAddress.toString()}`);
    console.log(`   RPC: ${harness.runtime.network.rpc}\n`);

    // Local setup auto-deploys through the backend-compatible path. Live
    // networks retain code-object deployment and require an explicit opt-in.
    const deployment = isLocal
      ? harness.runtime.getDeployment("counter")
      : await harness.deployCodeObject({ moduleName: "counter" });
    if (!deployment) {
      throw new Error("Local counter deployment record was not created");
    }

    console.log(`\n✅ Module deployed at: ${deployment.address}::counter`);
    if (deployment.txHash) {
      console.log(`   Transaction: ${deployment.txHash}`);
    }

    // Interact with the freshly deployed module via the runtime helper.
    const counter = harness.runtime.getContract(deployment.address, "counter");

    // Counter is a Move resource — it must be created explicitly per
    // account before any method that reads or mutates it. The dedicated
    // `init` entry function does this once per signer. (The module also
    // auto-inits inside `increment` as defense in depth, so this call is
    // technically optional today, but kept for pedagogy: real-world Move
    // modules usually require an explicit init step.)
    console.log("\n🔧 Initializing counter resource for this account...");
    const initTx = await counter.call(harness.runtime.account, "init", []);
    console.log(`   Init tx: ${initTx.hash}`);

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
    // call for every mode; local mode also releases the node lifecycle.
    await harness.cleanup();
  }
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error?.message || error);
  process.exit(1);
});
