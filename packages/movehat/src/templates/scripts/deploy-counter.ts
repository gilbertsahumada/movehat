import { setupTestEnvironment, getContract } from "movehat/helpers";

async function main() {
  console.log("🚀 Deploying Counter contract...\n");

  const env = await setupTestEnvironment();
  
  const counter = getContract(
    env.aptos,
    env.account.accountAddress.toString(),
    "counter"
  );

  console.log(`📍 Contract address: ${env.account.accountAddress.toString()}::counter`);
  
  // Initialize the counter
  console.log("\n📝 Initializing counter...");
  const txResult = await counter.call(env.account, "init", []);
  
  console.log(`✅ Transaction hash: ${txResult.hash}`);
  console.log(`✅ Counter initialized successfully!`);
  
  // Verify
  const value = await counter.view<number>("get", [
    env.account.accountAddress.toString()
  ]);
  
  console.log(`\n📊 Initial counter value: ${value}`);
}

main().catch((error) => {
  console.error("❌ Deployment failed:", error);
  process.exit(1);
});