import { Harness, HarnessDisposedError } from "movehat";

/**
 * Canonical example of `Harness.createFork` — the higher-level factory
 * that wraps `ForkManager` lifecycle (init / load / cleanup) behind
 * the same Harness surface used for local and live mode.
 *
 * What this demonstrates:
 *
 * 1. `createFork(network, apiKey?)` snapshots remote state and returns
 *    a read-only Harness pointed at the local fork RPC.
 * 2. `runViewFunction` works against the fork exactly as it does on
 *    live mode — same API, no replay-attack risk.
 * 3. Write methods (`deployCodeObject`, `upgradeCodeObject`,
 *    `runMoveScript`) throw synchronously on a fork Harness, with an
 *    error message pointing at `createLocal` / `createLive`.
 * 4. After `cleanup()`, the Proxy/Poisoning pattern rejects any
 *    further method call with `HarnessDisposedError`.
 *
 * Compare with `demo-fork.ts`, which exercises the lower-level
 * `ForkManager` API directly. Both are valid; the Harness path is the
 * recommended entrypoint for code that wants the same shape across
 * local / fork / live.
 *
 * Run: `npm run demo-harness-fork` (no PRIVATE_KEY required — forks
 * are read-only and don't need a signer).
 */

const COUNTER_ADDRESS =
  "0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9";

async function main() {
  console.log("Creating Harness against a testnet fork (read-only)...\n");

  const apiKey = process.env.MOVEMENT_API_KEY;
  const harness = await Harness.createFork("testnet", apiKey);

  try {
    console.log(`   Mode:    ${harness.mode}`);
    console.log(`   Network: ${harness.runtime.network.name}`);
    console.log(`   RPC:     ${harness.runtime.network.rpc}\n`);

    console.log("Querying the on-fork Counter state with runViewFunction...");
    const [value] = await harness.runViewFunction({
      function: `${COUNTER_ADDRESS}::counter::get`,
      functionArguments: [COUNTER_ADDRESS],
    });
    console.log(`   ${COUNTER_ADDRESS.slice(0, 12)}...::counter::get -> ${value}\n`);

    console.log("Confirming the write-rejection contract...");
    try {
      await harness.deployCodeObject({
        moduleName: "counter",
        addressName: "hello_blockchain",
      });
      console.error("   FAIL: deployCodeObject should have thrown");
      process.exit(1);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`   deployCodeObject rejected as expected: ${msg.split(";")[0]}\n`);
    }

    console.log("Cleaning up...");
    await harness.cleanup();

    console.log("Confirming post-cleanup poisoning...");
    try {
      await harness.runViewFunction({
        function: `${COUNTER_ADDRESS}::counter::get`,
        functionArguments: [COUNTER_ADDRESS],
      });
      console.error("   FAIL: post-cleanup call should have thrown");
      process.exit(1);
    } catch (error) {
      if (error instanceof HarnessDisposedError) {
        console.log(`   Post-cleanup call rejected with HarnessDisposedError`);
      } else {
        throw error;
      }
    }

    console.log("\nFork harness demo complete.");
  } catch (error) {
    await harness.cleanup().catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  console.error("Fork demo failed:", error?.message || error);
  process.exit(1);
});
