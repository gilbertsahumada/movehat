import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Harness } from "../../harness/index.js";
import { CliExecutionError } from "../../errors.js";
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from "../../utils/childProcessAdapter.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

describe("Harness.upgradeCodeObject", () => {
  let fixture: HarnessTestFixture;

  const EXISTING_OBJECT =
    "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const NEW_TX_HASH =
    "0x2222222222222222222222222222222222222222222222222222222222222222";

  beforeEach(() => {
    fixture = setupHarnessTestFixture({ withTmpHome: true });
  });

  afterEach(() => {
    fixture.teardown();
  });

  function makeAdapter(steps: { build: RunResult; upgrade: RunResult }): {
    adapter: ChildProcessAdapter;
    calls: RunInput[];
  } {
    const calls: RunInput[] = [];
    const adapter: ChildProcessAdapter = {
      async run(input) {
        calls.push(input);
        if (input.args[1] === "build") return steps.build;
        if (input.args[1] === "upgrade-object") return steps.upgrade;
        throw new Error(`unexpected movement subcommand: ${input.args[1]}`);
      },
      spawn() {
        throw new Error("spawn not used in codeObject.upgrade tests");
      },
    };
    return { adapter, calls };
  }

  function upgradeStdout(): string {
    return [
      "Building package...",
      "BUILDING dummy",
      "Successfully upgraded modules at object address " + EXISTING_OBJECT,
      `transaction hash: ${NEW_TX_HASH}`,
    ].join("\n");
  }

  it("happy path: upgrades existing object, returns DeploymentInfo with new txHash and the same (existing) address", async () => {
    const { adapter, calls } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      upgrade: { exitCode: 0, stdout: upgradeStdout(), stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.upgradeCodeObject({
        moduleName: "counter",
        objectAddress: EXISTING_OBJECT,
        adapter,
      });

      expect(result.address).toBe(EXISTING_OBJECT);
      expect(result.txHash).toBe(NEW_TX_HASH);
      expect(result.moduleName).toBe("counter");

      // Saved deployment record reflects the new state.
      const deploymentPath = join(fixture.tmpCwd, "deployments", "testnet", "counter.json");
      expect(existsSync(deploymentPath)).toBe(true);
      const saved = JSON.parse(readFileSync(deploymentPath, "utf-8"));
      expect(saved.address).toBe(EXISTING_OBJECT);
      expect(saved.txHash).toBe(NEW_TX_HASH);

      // CLI args contain the required --object-address flag.
      const upgradeCall = calls.find((c) => c.args[1] === "upgrade-object");
      expect(upgradeCall).toBeDefined();
      expect(upgradeCall?.args).toContain("--object-address");
      expect(upgradeCall?.args).toContain(EXISTING_OBJECT);
      expect(upgradeCall?.args.slice(0, 4)).toEqual([
        "move",
        "upgrade-object",
        "--address-name",
        "counter",
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("missing objectAddress throws synchronously before any CLI call", async () => {
    const { adapter, calls } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      upgrade: { exitCode: 0, stdout: upgradeStdout(), stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.upgradeCodeObject({
          moduleName: "counter",
          // Intentionally empty — exercise the early-throw path.
          objectAddress: "",
          adapter,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/objectAddress/);
      // No CLI calls should have been made.
      expect(calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("upgrade-object CLI failure rethrows AND cleans the temp profile", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      upgrade: {
        exitCode: 1,
        stdout: "",
        stderr: "upgrade failed: incompatible module",
      },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.upgradeCodeObject({
          moduleName: "counter",
          objectAddress: EXISTING_OBJECT,
          adapter,
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CliExecutionError);
      // Temp profile cleaned up in finally.
      expect(existsSync(join(fixture.tmpHome!, ".aptos", "config.yaml"))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});
