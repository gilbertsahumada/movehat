import { getMovehat, ModuleAlreadyDeployedError } from "movehat";

async function main() {
  console.log("🚀 Deploying Counter contract...\n");

  // Get the Movehat Runtime Environment
  const mh = await getMovehat();

  console.log(`✅ Runtime initialized`);
  console.log(`   Account: ${mh.account.accountAddress.toString()}`);
  console.log(`   Network: ${mh.network.name}`);
  console.log(`   RPC: ${mh.network.rpc}\n`);

  // Deploy (publish) the module
  // Automatically checks if already deployed and suggests --redeploy if needed
  const deployment = await mh.deployContract("counter");

  console.log(`\n✅ Module deployed at: ${deployment.address}::counter`);
  if (deployment.txHash) {
    console.log(`   Transaction: ${deployment.txHash}`);
  }

  // Get contract instance
  const counter = mh.getContract(deployment.address, "counter");

  // Increment the counter (this also initializes it if not exists)
  console.log("\n📝 Incrementing counter...");
  const txResult = await counter.call(mh.account, "increment", []);

  console.log(`✅ Transaction hash: ${txResult.hash}`);
  console.log(`✅ Counter incremented successfully!`);

  // Verify
  const value = await counter.view<number>("get", [
    mh.account.accountAddress.toString()
  ]);

  console.log(`\n📊 Counter value: ${value}`);
}

main().catch((error) => {
  // ModuleAlreadyDeployedError is already logged with full details by deployContract()
  // For other errors, show the message
  if (!(error instanceof ModuleAlreadyDeployedError)) {
    console.error("❌ Deployment failed:", error?.message || error);
  }
  process.exit(1);
});
