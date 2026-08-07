import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountAddress } from "@aptos-labs/ts-sdk";

import { Harness } from "../../harness/index.js";
import { fingerprintRpcUrl, saveDeployment } from "../../core/deployments.js";
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

  describe("SDK execution path (sdkExecute: true)", () => {
    function stageBuildArtifacts(): void {
      const pkg = join(fixture.tmpCwd, "move", "build", "dummy");
      mkdirSync(join(pkg, "bytecode_modules"), { recursive: true });
      writeFileSync(join(pkg, "package-metadata.bcs"), Buffer.from([1, 2, 3]));
      writeFileSync(
        join(pkg, "bytecode_modules", "counter.mv"),
        Buffer.from([9, 9])
      );
    }

    function makeBuildOnlyAdapter(): {
      adapter: ChildProcessAdapter;
      calls: RunInput[];
    } {
      const calls: RunInput[] = [];
      const adapter: ChildProcessAdapter = {
        async run(input) {
          calls.push(input);
          if (input.args[1] === "build") {
            return { exitCode: 0, stdout: "build ok", stderr: "" };
          }
          throw new Error(
            `CLI must not run subcommand '${input.args[1]}' on the SDK path`
          );
        },
        spawn() {
          throw new Error("spawn not used in codeObject.upgrade tests");
        },
      };
      return { adapter, calls };
    }

    function makeMockAptos() {
      return {
        getAccountInfo: vi.fn(async () => ({ sequence_number: "5" })),
        transaction: {
          build: { simple: vi.fn(async () => ({ rawTransaction: "raw" })) },
          sign: vi.fn(() => "senderAuth"),
          submit: { simple: vi.fn(async () => ({ hash: NEW_TX_HASH })) },
        },
        waitForTransaction: vi.fn(async () => ({
          success: true,
          vm_status: "Executed successfully",
        })),
        getAccountResource: vi.fn(async () => ({ packages: [] })),
      };
    }

    it("compiles against the existing object address and submits ::upgrade with it as third argument", async () => {
      stageBuildArtifacts();
      const { adapter, calls } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();
      const PRIOR_TX_HASH =
        "0x3333333333333333333333333333333333333333333333333333333333333333";

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;

        // Pre-existing record for the object being upgraded — lets the
        // test cover the previousTxHash chaining in the persisted record.
        saveDeployment({
          address: EXISTING_OBJECT,
          moduleName: "counter",
          network: "testnet",
          deployer: harness.runtime.account.accountAddress.toString(),
          timestamp: Date.now(),
          txHash: PRIOR_TX_HASH,
          schemaVersion: 2,
          chainId: "testnet",
          rpcFingerprint: fingerprintRpcUrl(harness.runtime.config.rpc),
          kind: "code-object",
        });

        const result = await harness.upgradeCodeObject({
          moduleName: "counter",
          objectAddress: EXISTING_OBJECT,
          sdkExecute: true,
          adapter,
        });

        expect(result.address).toBe(EXISTING_OBJECT);
        expect(result.txHash).toBe(NEW_TX_HASH);
        expect(result.kind).toBe("upgrade-object");

        // Persisted record: same address, new hash, prior hash chained.
        const saved = JSON.parse(
          readFileSync(
            join(fixture.tmpCwd, "deployments", "testnet", "counter.json"),
            "utf-8"
          )
        );
        expect(saved.address).toBe(EXISTING_OBJECT);
        expect(saved.txHash).toBe(NEW_TX_HASH);
        expect(saved.previousTxHash).toBe(PRIOR_TX_HASH);
        expect(saved.kind).toBe("upgrade-object");

        // Build binds the address name to the EXISTING object address.
        expect(calls).toHaveLength(1);
        const buildArgs = calls[0]!.args;
        expect(buildArgs).toContain("--save-metadata");
        const namedIdx = buildArgs.indexOf("--named-addresses");
        expect(buildArgs[namedIdx + 1]).toBe(`counter=${EXISTING_OBJECT}`);

        // ::upgrade, third argument = the object address; no sequence
        // number pin (nothing derives from it) and no derivation
        // cross-check read.
        const buildInput = aptos.transaction.build.simple.mock.calls[0]![0] as {
          data: { function: string; functionArguments: unknown[] };
          options?: { accountSequenceNumber?: bigint };
        };
        expect(buildInput.data.function).toBe(
          "0x1::object_code_deployment::upgrade"
        );
        expect(buildInput.options).toBeUndefined();
        expect(buildInput.data.functionArguments).toHaveLength(3);
        const third = buildInput.data.functionArguments[2];
        expect(third).toBeInstanceOf(AccountAddress);
        expect((third as AccountAddress).toString()).toBe(EXISTING_OBJECT);

        expect(aptos.getAccountInfo).not.toHaveBeenCalled();
        expect(aptos.getAccountResource).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });

    it("throws with the vm_status when the committed upgrade failed on-chain", async () => {
      stageBuildArtifacts();
      const { adapter } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();
      aptos.waitForTransaction.mockResolvedValueOnce({
        success: false,
        vm_status: "EPACKAGE_DEP_MISSING",
      });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        await expect(
          harness.upgradeCodeObject({
            moduleName: "counter",
            objectAddress: EXISTING_OBJECT,
            sdkExecute: true,
            adapter,
          })
        ).rejects.toThrow(/failed on-chain: EPACKAGE_DEP_MISSING/);
      } finally {
        await harness.cleanup();
      }
    });
  });
});
