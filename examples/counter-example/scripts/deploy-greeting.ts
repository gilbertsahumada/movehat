import { Harness, ModuleAlreadyDeployedError } from "movehat";

async function main() {
  console.log("🚀 Deploying Greeting contract...\n");

  const harness = await Harness.createLive("testnet");
  try {
    console.log(`✅ Runtime initialized`);
    console.log(`   Account: ${harness.runtime.account.accountAddress.toString()}`);
    console.log(`   Network: ${harness.runtime.network.name}`);
    console.log(`   RPC: ${harness.runtime.network.rpc}\n`);

    // Deploy (publish) the module
    // Automatically checks if already deployed and suggests --redeploy if needed
    const deployment = await harness.runtime.deployContract("greeting");

    console.log(`\n✅ Module deployed at: ${deployment.address}::greeting`);
    if (deployment.txHash) {
      console.log(`   Transaction: ${deployment.txHash}`);
    }

    // Get contract instance
    const greeting = harness.runtime.getContract(deployment.address, "greeting");

    // Set initial greeting
    console.log("\n📝 Setting initial greeting...");
    const txResult = await greeting.call(harness.runtime.account, "set_greeting", [
      "Hello, Movement Network!"
    ]);

    console.log(`✅ Transaction hash: ${txResult.hash}`);
    console.log(`✅ Greeting set successfully!`);

    // Verify
    const greetingText = await greeting.view<string>("get_greeting", [
      harness.runtime.account.accountAddress.toString()
    ]);

    console.log(`\n📊 Current greeting: "${greetingText}"`);

    // Get count
    const count = await greeting.view<string>("get_count", [
      harness.runtime.account.accountAddress.toString()
    ]);

    console.log(`📊 Greeting count: ${count}`);
  } finally {
    await harness.cleanup();
  }
}

main().catch((error) => {
  // ModuleAlreadyDeployedError is already logged with full details by deployContract()
  // For other errors, show the message
  if (!(error instanceof ModuleAlreadyDeployedError)) {
    console.error("❌ Deployment failed:", error?.message || error);
  }
  process.exit(1);
});
