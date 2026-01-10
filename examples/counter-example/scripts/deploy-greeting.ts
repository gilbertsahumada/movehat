import { getMovehat, ModuleAlreadyDeployedError } from "movehat";

async function main() {
  console.log("🚀 Deploying Greeting contract...\n");

  // Get the Movehat Runtime Environment
  const mh = await getMovehat();

  console.log(`✅ Runtime initialized`);
  console.log(`   Account: ${mh.account.accountAddress.toString()}`);
  console.log(`   Network: ${mh.network.name}`);
  console.log(`   RPC: ${mh.network.rpc}\n`);

  // Deploy (publish) the module
  // Automatically checks if already deployed and suggests --redeploy if needed
  const deployment = await mh.deployContract("greeting");

  console.log(`\n✅ Module deployed at: ${deployment.address}::greeting`);
  if (deployment.txHash) {
    console.log(`   Transaction: ${deployment.txHash}`);
  }

  // Get contract instance
  const greeting = mh.getContract(deployment.address, "greeting");

  // Set initial greeting
  console.log("\n📝 Setting initial greeting...");
  const txResult = await greeting.call(mh.account, "set_greeting", [
    "Hello, Movement Network!"
  ]);

  console.log(`✅ Transaction hash: ${txResult.hash}`);
  console.log(`✅ Greeting set successfully!`);

  // Verify
  const greetingText = await greeting.view<string>("get_greeting", [
    mh.account.accountAddress.toString()
  ]);

  console.log(`\n📊 Current greeting: "${greetingText}"`);

  // Get count
  const count = await greeting.view<string>("get_count", [
    mh.account.accountAddress.toString()
  ]);

  console.log(`📊 Greeting count: ${count}`);
}

main().catch((error) => {
  // ModuleAlreadyDeployedError is already logged with full details by deployContract()
  // For other errors, show the message
  if (!(error instanceof ModuleAlreadyDeployedError)) {
    console.error("❌ Deployment failed:", error?.message || error);
  }
  process.exit(1);
});
