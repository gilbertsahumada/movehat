// scripts/dogfood-fork-test.ts
//
// Run by the dogfood-test.sh orchestrator (step 9/9). Validates that
// fork-mode invariants hold against real testnet state:
//   1. Harness.createFork("testnet") spawns a working fork-mode instance.
//   2. Attempting a write (deployCodeObject) is rejected.
//   3. After cleanup(), property access on a poisoned method throws
//      HarnessDisposedError synchronously.
//
// Read-only verification of the on-chain side is intentionally limited:
// the fork server proxies /accounts and /resources but not module-ABI
// hydration, so SDK paths that load module ABI raise endpoint_not_found.
// See packages/docs/content/docs/api/harness.mdx "Fork-mode view caveat".

import { Harness, HarnessDisposedError } from "movehat";

async function main(): Promise<void> {
  console.log("Creating fork from testnet (this may take a few seconds)...");
  const harness = await Harness.createFork("testnet");

  console.log(
    `✓ Fork harness ready — mode=${harness.mode}, network=${harness.runtime.network.name}`
  );

  // --- Invariant 1: deployCodeObject must throw on a fork-mode harness ---
  let writeRejected = false;
  try {
    await harness.deployCodeObject({ moduleName: "dogfood_module" });
  } catch (err) {
    writeRejected = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`✓ deployCodeObject rejected: ${msg.split("\n")[0]}`);
  }
  if (!writeRejected) {
    throw new Error(
      "INVARIANT BROKEN: fork-mode deployCodeObject did NOT throw — writable forks are not supported (see issue #192)"
    );
  }

  // --- Invariant 2: cleanup() poisons the harness ---
  await harness.cleanup();
  console.log("✓ cleanup() completed");

  // --- Invariant 3: post-cleanup property access throws HarnessDisposedError ---
  let poisoned = false;
  try {
    // Property access on a poisoned method triggers the Proxy trap.
    harness.runViewFunction({ function: "0x1::nothing::nothing" });
  } catch (err) {
    poisoned = err instanceof HarnessDisposedError;
    if (poisoned) {
      console.log(
        `✓ post-cleanup harness throws HarnessDisposedError (method='${
          (err as HarnessDisposedError).methodName
        }')`
      );
    } else {
      throw err;
    }
  }
  if (!poisoned) {
    throw new Error(
      "INVARIANT BROKEN: post-cleanup harness did not throw HarnessDisposedError"
    );
  }

  console.log("FORK TEST PASSED");
}

main().catch((err: unknown) => {
  console.error(
    "FORK TEST FAILED:",
    err instanceof Error ? err.stack ?? err.message : String(err)
  );
  process.exit(1);
});
