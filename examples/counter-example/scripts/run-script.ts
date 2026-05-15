import { Harness } from "movehat";

/**
 * Canonical example of `harness.runMoveScript`. Move scripts are
 * one-shot transactions that bundle compiled bytecode in the
 * transaction itself — useful for orchestrating multi-step state
 * changes that don't justify a new module deployment.
 *
 * This example targets the inert `move/scripts/echo.move` script and
 * passes a typed `u64` argument. The CLI compiles the `.move` source
 * on the fly; no prior `movehat compile` step is required.
 *
 * `runMoveScript` is unavailable on fork-mode harnesses (forks are
 * read-only). Use `createLocal` for self-contained demos or
 * `createLive` for production submissions.
 *
 * Run: `npm run run-script`.
 */
async function main() {
  console.log("Running echo.move script on a local Movement node...\n");

  const harness = await Harness.createLocal();

  try {
    console.log(`   Signer: ${harness.runtime.account.accountAddress.toString()}`);

    const result = await harness.runMoveScript({
      scriptPath: "./move/scripts/echo.move",
      args: ["u64:42"],
    });

    console.log(`Script executed.`);
    console.log(`   tx:      ${result.txHash}`);
    if (result.success !== undefined) {
      console.log(`   success: ${result.success}`);
    }
    if (result.vmStatus) {
      console.log(`   status:  ${result.vmStatus}`);
    }
  } finally {
    await harness.cleanup();
  }
}

main().catch((error) => {
  console.error("Script failed:", error?.message || error);
  process.exit(1);
});
