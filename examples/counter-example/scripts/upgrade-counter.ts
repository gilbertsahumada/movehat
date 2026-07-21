import { Harness } from "movehat";
import config from "../movehat.config.js";

/**
 * Canonical example of `harness.upgradeCodeObject` — re-publishes the
 * compiled Move package into an existing code object on-chain.
 *
 * Prerequisite: a prior run of `scripts/deploy-counter.ts` against the
 * same live network. That run writes `deployments/{network}/counter.json`
 * with the object address; this script reads it back to derive the
 * `objectAddress` argument. The default `npm run deploy` targets a
 * disposable local chain, which an upgrade cannot reach afterwards —
 * both commands must select the same public network.
 *
 * The `addressName: "hello_blockchain"` mirrors `deploy-counter.ts` —
 * Move.toml's named address slot differs from the on-chain module id,
 * so the upgrade has to bind the same way the original deploy did.
 *
 * Run: `MOVEHAT_NETWORK=testnet npm run upgrade`
 * (after `MOVEHAT_NETWORK=testnet npm run deploy`).
 */
async function main() {
  console.log("Upgrading Counter contract...\n");

  const network =
    process.env.MH_CLI_NETWORK ??
    process.env.MOVEHAT_NETWORK ??
    process.env.MH_DEFAULT_NETWORK ??
    config.defaultNetwork ??
    "local";
  if (network === "local" || network === "movelite") {
    throw new Error(
      "Upgrades need a persistent network, and the default local chain is " +
      "disposable. Deploy and upgrade against the same live network:\n" +
      "  MOVEHAT_NETWORK=testnet npm run deploy\n" +
      "  MOVEHAT_NETWORK=testnet npm run upgrade"
    );
  }
  const harness = await Harness.createLive(network);
  try {
    const objectAddress = harness.runtime.getDeploymentAddress("counter");
    if (!objectAddress) {
      throw new Error(
        `No prior deployment found for "counter" on ${network}. ` +
        `Run \`MOVEHAT_NETWORK=${network} npm run deploy\` first ` +
        `(deploy and upgrade must target the same network).`
      );
    }

    console.log(`   Network:  ${harness.runtime.network.name}`);
    console.log(`   Object:   ${objectAddress}`);
    console.log(`   Deployer: ${harness.runtime.account.accountAddress.toString()}\n`);

    const upgrade = await harness.upgradeCodeObject({
      moduleName: "counter",
      addressName: "hello_blockchain",
      objectAddress,
    });

    console.log(`Upgrade tx: ${upgrade.txHash ?? "(unknown)"}`);
    console.log(`Module still reachable at: ${upgrade.address}::counter`);

    const [value] = await harness.runViewFunction({
      function: `${upgrade.address}::counter::get`,
      functionArguments: [harness.runtime.account.accountAddress.toString()],
    });
    console.log(`Counter state preserved through upgrade. value=${value}`);
  } finally {
    await harness.cleanup();
  }
}

main().catch((error) => {
  console.error("Upgrade failed:", error?.message || error);
  process.exit(1);
});
