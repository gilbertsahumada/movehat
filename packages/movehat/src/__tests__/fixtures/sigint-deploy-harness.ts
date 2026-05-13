/**
 * Stand-alone child-process harness for the SIGINT-cleanup test in
 * `deployContract.test.ts`. Run via tsx by the parent test; never picked
 * up by vitest's test glob (default matches `*.{test,spec}.?(c|m)[jt]s`).
 *
 * Behavior:
 *   1. Build a fake ChildProcessAdapter whose `publish` step awaits a
 *      long delay (3 seconds) — gives the parent test plenty of time to
 *      send SIGINT mid-flight.
 *   2. Drive `Publisher.deploy()` against the fake adapter using a
 *      synthetic MovehatConfig + Account read from env vars.
 *   3. Write the chosen `movehat-deploy-<uuid>` profile name to stdout
 *      as JSON (`{"profile": "..."}`) before the slow publish so the
 *      parent test knows which key to look for after SIGINT.
 *   4. If the deploy completes naturally (test failure case), exit 0.
 *   5. When SIGINT arrives, Publisher's signal handler runs synchronous
 *      cleanup and `setImmediate(() => process.exit(130))`.
 *
 * The parent test does NOT import this file — it spawns it via
 * `child_process.spawn(node, [tsx, harness, ...])` so the harness runs
 * in its own process with its own signal-handler installation.
 */

import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { Publisher } from "../../core/Publisher.js";
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from "../../utils/childProcessAdapter.js";
import type { MovehatConfig } from "../../types/config.js";

// Deterministic test key — must satisfy the Movement TypeScript SDK's Ed25519 parser.
// Same key the testnet auto-config uses in `core/config.ts:147-155`.
const TEST_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

async function main() {
  const account = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(TEST_PRIVATE_KEY),
  });

  const config: MovehatConfig = {
    network: "testnet",
    rpc: "https://testnet.invalid/v1",
    privateKey: TEST_PRIVATE_KEY,
    allAccounts: [TEST_PRIVATE_KEY],
    profile: "default",
    moveDir: "./move",
    account: account.accountAddress.toString(),
    namedAddresses: {},
    networkConfig: {
      url: "https://testnet.invalid/v1",
      chainId: "testnet",
    },
  };

  const slowPublishAdapter: ChildProcessAdapter = {
    async run(input: RunInput): Promise<RunResult> {
      if (input.args[1] === "build") {
        return { exitCode: 0, stdout: "built", stderr: "" };
      }
      if (input.args[1] === "publish") {
        // Surface the unique profile name to the parent BEFORE blocking.
        const profileIdx = input.args.indexOf("--profile");
        const profile = profileIdx >= 0 ? input.args[profileIdx + 1] : "";
        process.stdout.write(JSON.stringify({ profile }) + "\n");
        // Hold long enough for the parent to deliver SIGINT.
        await new Promise((r) => setTimeout(r, 3000));
        return {
          exitCode: 0,
          stdout: "Transaction hash: 0x" + "f".repeat(64),
          stderr: "",
        };
      }
      throw new Error(`unexpected subcommand: ${input.args[1]}`);
    },
    spawn() {
      throw new Error("spawn not used");
    },
  };

  const publisher = new Publisher({ adapter: slowPublishAdapter });
  await publisher.deploy({
    moduleName: "sigint_harness",
    config,
    account,
    packageDir: process.cwd(),
  });
}

main().catch((err) => {
  process.stderr.write(`harness error: ${(err as Error).message}\n`);
  process.exit(2);
});
