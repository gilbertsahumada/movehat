import { getMovehat } from "movehat";

async function main() {
  console.log("🚀 Deploying Counter contract...\n");

  // Get the Movehat Runtime Environment
  const mh = await getMovehat();

  console.log(`✅ Runtime initialized`);
  console.log(`   Account: ${mh.account.accountAddress.toString()}`);
  console.log(`   Network: ${mh.network.name}`);
  console.log(`   RPC: ${mh.network.rpc}\n`);

  // Get contract instance
  const counter = mh.getContract(
    mh.account.accountAddress.toString(),
    "counter"
  );

  console.log(`📍 Contract address: ${mh.account.accountAddress.toString()}::counter`);

  // Initialize the counter
  console.log("\n📝 Initializing counter...");
  const txResult = await counter.call(mh.account, "init", []);

  console.log(`✅ Transaction hash: ${txResult.hash}`);
  console.log(`✅ Counter initialized successfully!`);

  // Verify
  const value = await counter.view<number>("get", [
    mh.account.accountAddress.toString()
  ]);

  console.log(`\n📊 Initial counter value: ${value}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});