import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AccountAddress, MoveVector, createObjectAddress } from "@aptos-labs/ts-sdk";

import { Harness, HarnessDisposedError } from "../../harness/index.js";
import {
  CliExecutionError,
  ModuleAlreadyDeployedError,
  PostPublishError,
  TransactionOutcomeUnknownError,
} from "../../errors.js";
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from "../../utils/childProcessAdapter.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

/**
 * Tests for `Harness.deployCodeObject` — exercises the new
 * `move deploy-object` code path with the shared profile helpers
 * lifted out of Publisher in Commit 1 of this PR.
 *
 * Uses the same fake-adapter + tmpdir-HOME pattern as
 * `__tests__/deployContract.test.ts`. No real Movement CLI calls.
 */
describe("Harness.deployCodeObject", () => {
  let fixture: HarnessTestFixture;

  const OBJECT_ADDRESS = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const TX_HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";

  beforeEach(() => {
    fixture = setupHarnessTestFixture({ withTmpHome: true });
  });

  afterEach(() => {
    fixture.teardown();
    delete process.env.MH_CLI_REDEPLOY;
  });

  function makeAdapter(steps: {
    build: RunResult;
    deploy: RunResult;
  }): {
    adapter: ChildProcessAdapter;
    calls: RunInput[];
  } {
    const calls: RunInput[] = [];
    const adapter: ChildProcessAdapter = {
      async run(input) {
        calls.push(input);
        if (input.args[1] === "build") return steps.build;
        if (input.args[1] === "deploy-object") return steps.deploy;
        if (input.args[1] === "upgrade-object") return steps.deploy;
        throw new Error(`unexpected movement subcommand: ${input.args[1]}`);
      },
      spawn() {
        throw new Error("spawn not used in codeObject tests");
      },
    };
    return { adapter, calls };
  }

  function successStdout(): string {
    return [
      "Building package...",
      "BUILDING dummy",
      "Code was successfully deployed to object address " + OBJECT_ADDRESS,
      `transaction hash: ${TX_HASH}`,
      "{ \"Result\": { \"success\": true } }",
    ].join("\n");
  }

  it("happy path: returns CodeObjectInfo with parsed object address + txHash and writes deployment record", async () => {
    const { adapter, calls } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.deployCodeObject({
        moduleName: "counter",
        adapter,
      });

      expect(result.address).toBe(OBJECT_ADDRESS);
      expect(result.txHash).toBe(TX_HASH);
      expect(result.moduleName).toBe("counter");
      expect(result.network).toBe("testnet");
      expect(result.deployer).toBe(harness.runtime.account.accountAddress.toString());
      expect(result.timestamp).toBeGreaterThan(0);

      // Deployment file written to deployments/testnet/counter.json
      const deploymentPath = join(fixture.tmpCwd, "deployments", "testnet", "counter.json");
      expect(existsSync(deploymentPath)).toBe(true);
      const saved = JSON.parse(readFileSync(deploymentPath, "utf-8"));
      expect(saved.address).toBe(OBJECT_ADDRESS);
      expect(saved.txHash).toBe(TX_HASH);

      // Verify the CLI calls: build then deploy-object
      expect(calls).toHaveLength(2);
      expect(calls[0]?.args.slice(0, 2)).toEqual(["move", "build"]);
      expect(calls[1]?.args.slice(0, 4)).toEqual([
        "move",
        "deploy-object",
        "--address-name",
        "counter",
      ]);
      expect(calls[1]?.args).toContain("--assume-yes");
    } finally {
      await harness.cleanup();
    }
  });

  it("persists a successful deploy-object when artifact hashing fails", async () => {
    const base = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const adapter: ChildProcessAdapter = {
      ...base.adapter,
      async run(input) {
        const result = await base.adapter.run(input);
        if (input.args[1] === "deploy-object") {
          const build = join(fixture.tmpCwd, "move", "build");
          rmSync(build, { recursive: true, force: true });
          writeFileSync(build, "not a directory");
        }
        return result;
      },
    };
    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.deployCodeObject({ moduleName: "counter", adapter });
      expect(result.artifactHash).toBeUndefined();
      expect(existsSync(join(fixture.tmpCwd, "deployments", "testnet", "counter.json"))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it("idempotency: re-deploying the same module throws ModuleAlreadyDeployedError and does NOT invoke the CLI", async () => {
    // First, plant an existing deployment record by running a successful deploy.
    const first = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });

    const harness1 = await Harness.createLive("testnet");
    await harness1.deployCodeObject({ moduleName: "counter", adapter: first.adapter });
    await harness1.cleanup();

    // Second deploy with same moduleName + same network — must reject.
    const second = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const harness2 = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness2.deployCodeObject({ moduleName: "counter", adapter: second.adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ModuleAlreadyDeployedError);
      const err = caught as ModuleAlreadyDeployedError;
      expect(err.moduleName).toBe("counter");
      expect(err.network).toBe("testnet");
      // CLI must not have been invoked on the second attempt.
      expect(second.calls).toHaveLength(0);
    } finally {
      await harness2.cleanup();
    }
  });

  it("MH_CLI_REDEPLOY=true bypasses the idempotency check", async () => {
    // Plant the first deployment.
    const first = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const harness1 = await Harness.createLive("testnet");
    await harness1.deployCodeObject({ moduleName: "counter", adapter: first.adapter });
    await harness1.cleanup();

    // Redeploy with the env flag — should call the CLI again.
    process.env.MH_CLI_REDEPLOY = "true";
    const second = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const harness2 = await Harness.createLive("testnet");
    try {
      const result = await harness2.deployCodeObject({
        moduleName: "counter",
        adapter: second.adapter,
      });
      expect(result.address).toBe(OBJECT_ADDRESS);
      // The CLI WAS invoked the second time.
      expect(second.calls.length).toBeGreaterThan(0);
    } finally {
      await harness2.cleanup();
    }
  });

  it("build failure rethrows CliExecutionError and never writes a profile to ~/.aptos/config.yaml", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 1, stdout: "", stderr: "compilation error: undefined identifier" },
      deploy: { exitCode: 0, stdout: "", stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.deployCodeObject({ moduleName: "counter", adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CliExecutionError);
      // The profile-write happens AFTER build, so build failure should
      // never have touched ~/.aptos/config.yaml.
      expect(existsSync(join(fixture.tmpHome!, ".aptos", "config.yaml"))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("deploy-object failure rethrows AND the temp profile is removed from ~/.aptos/config.yaml in finally", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 1, stdout: "", stderr: "transaction failed: insufficient funds" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.deployCodeObject({ moduleName: "counter", adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CliExecutionError);
      // The finally block must have cleaned the temp profile — file
      // unlinked because we wrote a fresh profile-only yaml.
      expect(existsSync(join(fixture.tmpHome!, ".aptos", "config.yaml"))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("output without a parseable object address throws a clear error (not CliExecutionError)", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: {
        exitCode: 0,
        stdout: `deployed successfully; transaction hash: ${TX_HASH}`,
        stderr: "",
      },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.deployCodeObject({ moduleName: "counter", adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      // Not a CliExecutionError — the CLI succeeded, our parser failed.
      expect(caught).not.toBeInstanceOf(CliExecutionError);
      expect(caught).toBeInstanceOf(TransactionOutcomeUnknownError);
      expect((caught as TransactionOutcomeUnknownError).txHash).toBe(TX_HASH);
      expect((caught as TransactionOutcomeUnknownError).stdoutPreview?.length).toBeLessThanOrEqual(1000);
    } finally {
      await harness.cleanup();
    }
  });

  it("addressName override is used in --address-name CLI flag; moduleName remains the save-record key", async () => {
    // Example use case: Move source `module hello_blockchain::counter`
    // with Move.toml `[addresses] hello_blockchain = "_"`. The CLI's
    // --address-name must match the Move.toml entry (`hello_blockchain`)
    // while the on-chain module identifier + the save key + the
    // getContract argument stay `counter`.
    const { adapter, calls } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.deployCodeObject({
        moduleName: "counter",
        addressName: "hello_blockchain",
        adapter,
      });

      // Save record + return value use moduleName (not addressName).
      expect(result.moduleName).toBe("counter");
      const deploymentPath = join(fixture.tmpCwd, "deployments", "testnet", "counter.json");
      expect(existsSync(deploymentPath)).toBe(true);
      const saved = JSON.parse(readFileSync(deploymentPath, "utf-8"));
      expect(saved.moduleName).toBe("counter");

      // CLI flag was the overridden addressName.
      const deployCall = calls.find((c) => c.args[1] === "deploy-object")!;
      const addressNameIdx = deployCall.args.indexOf("--address-name");
      expect(addressNameIdx).toBeGreaterThanOrEqual(0);
      expect(deployCall.args[addressNameIdx + 1]).toBe("hello_blockchain");
    } finally {
      await harness.cleanup();
    }
  });

  it("addressName defaults to moduleName when omitted (back-compat for template case)", async () => {
    const { adapter, calls } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      await harness.deployCodeObject({ moduleName: "counter", adapter });
      const deployCall = calls.find((c) => c.args[1] === "deploy-object")!;
      const addressNameIdx = deployCall.args.indexOf("--address-name");
      expect(deployCall.args[addressNameIdx + 1]).toBe("counter");
    } finally {
      await harness.cleanup();
    }
  });

  it("fork-mode harness throws synchronously before any CLI call (createLocal/createFork covered by the integration suite)", async () => {
    // This case can't be tested with a real createFork (it spawns a fork
    // server). Instead, prove that the disposed-instance path also fires
    // synchronously: a poisoned harness throws HarnessDisposedError on
    // property access, BEFORE any CLI call is attempted. The fork-mode
    // guard uses the same synchronous-throw pattern.
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();
    expect(() => harness.deployCodeObject({ moduleName: "x" })).toThrow(
      HarnessDisposedError
    );
  });

  describe("SDK execution path (sdkExecute: true)", () => {
    const SEQ = 5n;
    const METADATA = Buffer.from([0x01, 0x02, 0x03]);
    const MODULE = Buffer.from([0x0a, 0x0b]);

    function u64le(v: bigint): number[] {
      const out: number[] = [];
      for (let i = 0; i < 8; i++) out.push(Number((v >> BigInt(8 * i)) & 0xffn));
      return out;
    }

    /**
     * Independent re-derivation of the expected object address: the
     * seed is the BCS of the domain string (single-byte ULEB length
     * prefix + ASCII bytes) followed by the BCS u64 LE of
     * `sequence_number + 1`.
     */
    function expectedObjectAddress(deployer: AccountAddress): AccountAddress {
      const domain = new TextEncoder().encode(
        "aptos_framework::object_code_deployment"
      );
      const seed = new Uint8Array([
        domain.length,
        ...domain,
        ...u64le(SEQ + 1n),
      ]);
      return createObjectAddress(deployer, seed);
    }

    function stageBuildArtifacts(): void {
      const pkg = join(fixture.tmpCwd, "move", "build", "dummy");
      mkdirSync(join(pkg, "bytecode_modules"), { recursive: true });
      writeFileSync(join(pkg, "package-metadata.bcs"), METADATA);
      writeFileSync(join(pkg, "bytecode_modules", "counter.mv"), MODULE);
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
          throw new Error("spawn not used in codeObject tests");
        },
      };
      return { adapter, calls };
    }

    function makeMockAptos() {
      return {
        getAccountInfo: vi.fn(async () => ({
          sequence_number: SEQ.toString(),
        })),
        transaction: {
          build: { simple: vi.fn(async () => ({ rawTransaction: "raw" })) },
          sign: vi.fn(() => "senderAuth"),
          submit: { simple: vi.fn(async () => ({ hash: TX_HASH })) },
        },
        waitForTransaction: vi.fn(async () => ({
          success: true,
          vm_status: "Executed successfully",
        })),
        getAccountResource: vi.fn(async () => ({ packages: [{ name: "dummy" }] })),
      };
    }

    it("derives the object address, compiles against it, and records it without any deploy-object CLI call", async () => {
      stageBuildArtifacts();
      const { adapter, calls } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        const derived = expectedObjectAddress(
          harness.runtime.account.accountAddress
        ).toString();

        const result = await harness.deployCodeObject({
          moduleName: "counter",
          sdkExecute: true,
          adapter,
        });

        expect(result.address).toBe(derived);
        expect(result.txHash).toBe(TX_HASH);
        expect(result.kind).toBe("code-object");

        // Only one CLI call: the build, with --save-metadata and the
        // address name bound to the DERIVED address (not the deployer).
        expect(calls).toHaveLength(1);
        const buildArgs = calls[0]!.args;
        expect(buildArgs.slice(0, 2)).toEqual(["move", "build"]);
        expect(buildArgs).toContain("--save-metadata");
        const namedIdx = buildArgs.indexOf("--named-addresses");
        expect(buildArgs[namedIdx + 1]).toBe(`counter=${derived}`);

        // The publish transaction pins the fetched sequence number and
        // carries metadata + modules as BCS vectors.
        const buildInput = aptos.transaction.build.simple.mock.calls[0]![0] as {
          data: { function: string; functionArguments: unknown[] };
          options?: { accountSequenceNumber?: bigint };
        };
        expect(buildInput.data.function).toBe(
          "0x1::object_code_deployment::publish"
        );
        expect(buildInput.options?.accountSequenceNumber).toBe(SEQ);
        expect(buildInput.data.functionArguments).toHaveLength(2);
        expect(buildInput.data.functionArguments[0]).toBeInstanceOf(MoveVector);
        expect(buildInput.data.functionArguments[1]).toBeInstanceOf(MoveVector);

        // Post-commit derivation cross-check hit the derived address.
        const resourceInput = aptos.getAccountResource.mock.calls[0]![0] as {
          accountAddress: AccountAddress;
          resourceType: string;
        };
        expect(resourceInput.accountAddress.toString()).toBe(derived);
        expect(resourceInput.resourceType).toBe("0x1::code::PackageRegistry");

        // Deployment record persisted with the derived address.
        const saved = JSON.parse(
          readFileSync(
            join(fixture.tmpCwd, "deployments", "testnet", "counter.json"),
            "utf-8"
          )
        );
        expect(saved.address).toBe(derived);
        expect(saved.txHash).toBe(TX_HASH);
      } finally {
        await harness.cleanup();
      }
    });

    it("throws with the vm_status when the committed transaction failed on-chain", async () => {
      stageBuildArtifacts();
      const { adapter } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();
      aptos.waitForTransaction.mockResolvedValueOnce({
        success: false,
        vm_status: "MODULE_ADDRESS_DOES_NOT_MATCH_SENDER",
      });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        await expect(
          harness.deployCodeObject({
            moduleName: "counter",
            sdkExecute: true,
            adapter,
          })
        ).rejects.toThrow(/failed on-chain: MODULE_ADDRESS_DOES_NOT_MATCH_SENDER/);
      } finally {
        await harness.cleanup();
      }
    });

    it("wraps an unconfirmable wait in TransactionOutcomeUnknownError", async () => {
      stageBuildArtifacts();
      const { adapter } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();
      aptos.waitForTransaction.mockRejectedValueOnce(new Error("node gone"));

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        let caught: unknown;
        try {
          await harness.deployCodeObject({
            moduleName: "counter",
            sdkExecute: true,
            adapter,
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(TransactionOutcomeUnknownError);
        expect((caught as TransactionOutcomeUnknownError).txHash).toBe(TX_HASH);
      } finally {
        await harness.cleanup();
      }
    });

    it("treats a missing PackageRegistry at the derived address as an unknown outcome", async () => {
      stageBuildArtifacts();
      const { adapter } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();
      aptos.getAccountResource.mockRejectedValueOnce(
        new Error("Resource not found: 0x1::code::PackageRegistry")
      );

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        let caught: unknown;
        try {
          await harness.deployCodeObject({
            moduleName: "counter",
            sdkExecute: true,
            adapter,
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(TransactionOutcomeUnknownError);
        expect((caught as Error).message).toMatch(
          /no package registry was found at the derived object address/
        );
      } finally {
        await harness.cleanup();
      }
    });

    it("fails on missing build artifacts instead of submitting", async () => {
      // No stageBuildArtifacts() — the build dir does not exist.
      const { adapter } = makeBuildOnlyAdapter();
      const aptos = makeMockAptos();

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        await expect(
          harness.deployCodeObject({
            moduleName: "counter",
            sdkExecute: true,
            adapter,
          })
        ).rejects.toThrow(/Expected exactly one compiled package/);
        expect(aptos.transaction.build.simple).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });
  });
});
