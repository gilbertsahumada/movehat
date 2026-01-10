/**
 * Fork Demo Script
 * 
 * This script demonstrates the power of MoveHat's fork system:
 * 1. Create a fork of testnet
 * 2. Query a deployed contract's state from the fork
 * 3. Modify state locally without affecting the real network
 * 
 * Perfect for testing against real deployed contracts!
 */

import { ForkManager } from "movehat";
import * as path from "path";

// Contract deployed on testnet
const COUNTER_ADDRESS = "0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9";
const COUNTER_RESOURCE = `${COUNTER_ADDRESS}::counter::Counter`;

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🍴 MoveHat Fork Demo - Query Real Contracts Locally");
  console.log("=".repeat(60) + "\n");

  // Step 1: Create/Load a fork
  const forkPath = path.join(process.cwd(), ".movehat/forks/demo-fork");
  const fork = new ForkManager(forkPath);

  console.log("📸 Creating fork of Movement testnet...\n");
  
  try {
    await fork.initialize("https://testnet.movementnetwork.xyz/v1", "testnet");
    console.log("✅ Fork created successfully!");
  } catch (e: any) {
    if (e.message?.includes("already exists")) {
      fork.load();
      console.log("✅ Loaded existing fork");
    } else {
      throw e;
    }
  }

  const metadata = fork.getMetadata();
  console.log(`   Chain ID: ${metadata.chainId}`);
  console.log(`   Ledger Version: ${metadata.ledgerVersion}`);
  console.log(`   Network: ${metadata.network}\n`);

  // Step 2: Query the Counter contract state
  console.log("─".repeat(60));
  console.log("📖 Reading Counter contract state from fork...\n");
  console.log(`   Contract: ${COUNTER_ADDRESS}::counter`);
  console.log(`   Resource: Counter\n`);

  try {
    const counterState = await fork.getResource(COUNTER_ADDRESS, COUNTER_RESOURCE);
    
    console.log("✅ Counter state retrieved!");
    console.log(`   Value: ${counterState.value}\n`);
    console.log("   Raw resource data:");
    console.log(`   ${JSON.stringify(counterState, null, 2)}\n`);
  } catch (error: any) {
    console.log(`❌ Could not read Counter: ${error.message}\n`);
  }

  // Step 3: Try to read a non-existent counter (for a random account)
  console.log("─".repeat(60));
  console.log("📖 Trying to read Counter for a random account...\n");
  
  const randomAccount = "0x" + "a".repeat(64);
  console.log(`   Account: ${randomAccount.slice(0, 20)}...${randomAccount.slice(-8)}`);
  
  try {
    await fork.getResource(randomAccount, COUNTER_RESOURCE);
    console.log("   ✅ Counter exists (unexpected!)\n");
  } catch (error: any) {
    console.log("   ❌ Counter not found (expected - account hasn't initialized one)\n");
  }

  // Step 4: Demonstrate local state modification
  console.log("─".repeat(60));
  console.log("🔧 Modifying fork state locally...\n");
  console.log("   This changes the local fork WITHOUT affecting testnet!\n");

  // Read current state
  const currentState = await fork.getResource(COUNTER_ADDRESS, COUNTER_RESOURCE);
  const originalValue = currentState.value;
  
  // Modify locally
  currentState.value = "999";
  await fork.setResource(COUNTER_ADDRESS, COUNTER_RESOURCE, currentState);
  
  // Read back
  const modifiedState = await fork.getResource(COUNTER_ADDRESS, COUNTER_RESOURCE);
  
  console.log(`   Original value: ${originalValue}`);
  console.log(`   Modified value: ${modifiedState.value}`);
  console.log("\n   💡 The real testnet contract still has value = " + originalValue);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("✨ Fork Demo Complete!");
  console.log("=".repeat(60));
  console.log("\n🎯 Key Takeaways:");
  console.log("   • Forks let you query real deployed contracts locally");
  console.log("   • Changes are isolated - they don't affect the real network");
  console.log("   • Perfect for testing against production contracts");
  console.log("   • No gas fees for read operations!\n");
}

main().catch(console.error);
