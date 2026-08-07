import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { U64 } from "@aptos-labs/ts-sdk";

import { Harness } from "../../harness/index.js";
import { CliExecutionError, TransactionOutcomeUnknownError } from "../../errors.js";
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from "../../utils/childProcessAdapter.js";
import { setupHarnessTestFixture, type HarnessTestFixture } from "./_fixture.js";

describe("Harness.runMoveScript", () => {
  let fixture: HarnessTestFixture;

  const TX_HASH =
    "0x9999999999999999999999999999999999999999999999999999999999999999";

  beforeEach(() => {
    fixture = setupHarnessTestFixture({ withTmpHome: true });
  });

  afterEach(() => {
    fixture.teardown();
  });

  function makeAdapter(result: RunResult): {
    adapter: ChildProcessAdapter;
    calls: RunInput[];
  } {
    const calls: RunInput[] = [];
    const adapter: ChildProcessAdapter = {
      async run(input) {
        calls.push(input);
        if (input.args[1] === "run-script") return result;
        throw new Error(`unexpected movement subcommand: ${input.args[1]}`);
      },
      spawn() {
        throw new Error("spawn not used in script tests");
      },
    };
    return { adapter, calls };
  }

  function successStdout(): string {
    return [
      `transaction hash: ${TX_HASH}`,
      '{ "Result": { "success": true, "vm_status": "Executed successfully" } }',
    ].join("\n");
  }

  it("happy path with .move source: uses --script-path and returns parsed MoveScriptResult", async () => {
    const scriptPath = join(fixture.tmpCwd, "scripts", "init.move");
    mkdirSync(join(fixture.tmpCwd, "scripts"), { recursive: true });
    writeFileSync(scriptPath, "// dummy move script\n");

    const { adapter, calls } = makeAdapter({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.runMoveScript({
        scriptPath,
        args: ["u64:42", "bool:true"],
        typeArgs: ["0x1::aptos_coin::AptosCoin"],
        adapter,
      });

      expect(result.txHash).toBe(TX_HASH);
      expect(result.success).toBe(true);
      expect(result.vmStatus).toBe("Executed successfully");

      expect(calls).toHaveLength(1);
      const call = calls[0]!;
      expect(call.args.slice(0, 2)).toEqual(["move", "run-script"]);
      expect(call.args).toContain("--script-path");
      expect(call.args).not.toContain("--compiled-script-path");
      expect(call.args).toContain(scriptPath);
      expect(call.args).toContain("--type-args");
      expect(call.args).toContain("0x1::aptos_coin::AptosCoin");
      expect(call.args).toContain("--args");
      expect(call.args).toContain("u64:42");
      expect(call.args).toContain("bool:true");
    } finally {
      await harness.cleanup();
    }
  });

  it("happy path with .mv compiled: uses --compiled-script-path", async () => {
    const scriptPath = join(fixture.tmpCwd, "build", "init.mv");
    mkdirSync(join(fixture.tmpCwd, "build"), { recursive: true });
    writeFileSync(scriptPath, "compiled bytecode placeholder");

    const { adapter, calls } = makeAdapter({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.runMoveScript({ scriptPath, adapter });

      expect(result.txHash).toBe(TX_HASH);
      const call = calls[0]!;
      expect(call.args).toContain("--compiled-script-path");
      expect(call.args).not.toContain("--script-path");
    } finally {
      await harness.cleanup();
    }
  });

  it("unsupported extension throws synchronously before any CLI call", async () => {
    const scriptPath = join(fixture.tmpCwd, "notes.txt");
    writeFileSync(scriptPath, "not a script");

    const { adapter, calls } = makeAdapter({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.runMoveScript({ scriptPath, adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/unsupported script extension/i);
      expect(calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("missing script file throws before any CLI call", async () => {
    const scriptPath = join(fixture.tmpCwd, "scripts", "missing.move");
    const { adapter, calls } = makeAdapter({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.runMoveScript({ scriptPath, adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/script not found/i);
      expect(calls).toHaveLength(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("CLI failure rethrows CliExecutionError and removes the temp profile", async () => {
    const scriptPath = join(fixture.tmpCwd, "scripts", "fail.move");
    mkdirSync(join(fixture.tmpCwd, "scripts"), { recursive: true });
    writeFileSync(scriptPath, "// dummy\n");

    const { adapter } = makeAdapter({
      exitCode: 1,
      stdout: "",
      stderr: "compile error: undefined identifier",
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.runMoveScript({ scriptPath, adapter });
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

  it("CLI succeeded but output has no txHash: throws clear non-CliExecutionError", async () => {
    const scriptPath = join(fixture.tmpCwd, "scripts", "weird.move");
    mkdirSync(join(fixture.tmpCwd, "scripts"), { recursive: true });
    writeFileSync(scriptPath, "// dummy\n");

    const { adapter } = makeAdapter({
      exitCode: 0,
      stdout: "ran successfully but no hash here",
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.runMoveScript({ scriptPath, adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(CliExecutionError);
      expect((caught as Error).message).toMatch(/Could not parse transaction hash/);
    } finally {
      await harness.cleanup();
    }
  });

  it("`success: false` in Result JSON surfaces in MoveScriptResult.success", async () => {
    const scriptPath = join(fixture.tmpCwd, "scripts", "bad.move");
    mkdirSync(join(fixture.tmpCwd, "scripts"), { recursive: true });
    writeFileSync(scriptPath, "// dummy\n");

    const { adapter } = makeAdapter({
      exitCode: 0,
      stdout: [
        `transaction hash: ${TX_HASH}`,
        '{ "Result": { "success": false, "vm_status": "ABORTED" } }',
      ].join("\n"),
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.runMoveScript({ scriptPath, adapter });
      expect(result.txHash).toBe(TX_HASH);
      expect(result.success).toBe(false);
      expect(result.vmStatus).toBe("ABORTED");
    } finally {
      await harness.cleanup();
    }
  });

  describe("SDK execution path (sdkExecute: true)", () => {
    const SCRIPT_BYTES = Buffer.from([0xa1, 0x1c, 0xeb, 0x0b, 0x06]);

    function makeMockAptos(waitResponse: Record<string, unknown>) {
      const aptos = {
        transaction: {
          build: {
            simple: vi.fn(async () => ({ rawTransaction: "raw" })),
          },
          sign: vi.fn(() => "senderAuth"),
          submit: {
            simple: vi.fn(async () => ({ hash: TX_HASH })),
          },
        },
        waitForTransaction: vi.fn(async () => waitResponse),
      };
      return aptos;
    }

    function writeCompiledScript(): string {
      const scriptPath = join(fixture.tmpCwd, "build", "main.mv");
      mkdirSync(join(fixture.tmpCwd, "build"), { recursive: true });
      writeFileSync(scriptPath, SCRIPT_BYTES);
      return scriptPath;
    }

    it("submits the .mv bytecode via the SDK and never invokes the CLI", async () => {
      const scriptPath = writeCompiledScript();
      const { adapter, calls } = makeAdapter({
        exitCode: 0,
        stdout: successStdout(),
        stderr: "",
      });
      const aptos = makeMockAptos({
        type: "user_transaction",
        success: true,
        vm_status: "Executed successfully",
      });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        const result = await harness.runMoveScript({
          scriptPath,
          args: ["u64:42"],
          typeArgs: ["0x1::aptos_coin::AptosCoin"],
          sdkExecute: true,
          adapter,
        });

        expect(result).toEqual({
          txHash: TX_HASH,
          success: true,
          vmStatus: "Executed successfully",
        });
        expect(calls).toHaveLength(0);

        const buildInput = aptos.transaction.build.simple.mock.calls[0]![0] as {
          data: {
            bytecode: Uint8Array;
            typeArguments: string[];
            functionArguments: unknown[];
          };
        };
        expect(Buffer.from(buildInput.data.bytecode)).toEqual(SCRIPT_BYTES);
        expect(buildInput.data.typeArguments).toEqual([
          "0x1::aptos_coin::AptosCoin",
        ]);
        expect(buildInput.data.functionArguments).toHaveLength(1);
        expect(buildInput.data.functionArguments[0]).toBeInstanceOf(U64);
        expect((buildInput.data.functionArguments[0] as U64).value).toBe(42n);

        const waitInput = aptos.waitForTransaction.mock.calls[0]![0] as {
          options?: { checkSuccess?: boolean };
        };
        expect(waitInput.options?.checkSuccess).toBe(false);
      } finally {
        await harness.cleanup();
      }
    });

    it("rejects uncompiled .move sources with a pre-compile pointer", async () => {
      const scriptPath = join(fixture.tmpCwd, "scripts", "init.move");
      mkdirSync(join(fixture.tmpCwd, "scripts"), { recursive: true });
      writeFileSync(scriptPath, "// dummy move script\n");
      const { adapter, calls } = makeAdapter({
        exitCode: 0,
        stdout: successStdout(),
        stderr: "",
      });
      const aptos = makeMockAptos({ success: true });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        await expect(
          harness.runMoveScript({ scriptPath, sdkExecute: true, adapter })
        ).rejects.toThrow(/movement move compile/);
        expect(calls).toHaveLength(0);
        expect(aptos.transaction.build.simple).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });

    it("returns success:false without throwing when the committed tx failed", async () => {
      const scriptPath = writeCompiledScript();
      const aptos = makeMockAptos({
        type: "user_transaction",
        success: false,
        vm_status: "ABORTED",
      });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        const result = await harness.runMoveScript({
          scriptPath,
          sdkExecute: true,
        });
        expect(result.txHash).toBe(TX_HASH);
        expect(result.success).toBe(false);
        expect(result.vmStatus).toBe("ABORTED");
      } finally {
        await harness.cleanup();
      }
    });

    it("wraps an unconfirmable wait in TransactionOutcomeUnknownError carrying the hash", async () => {
      const scriptPath = writeCompiledScript();
      const aptos = makeMockAptos({});
      aptos.waitForTransaction.mockRejectedValueOnce(
        new Error("node went away")
      );

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        let caught: unknown;
        try {
          await harness.runMoveScript({ scriptPath, sdkExecute: true });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(TransactionOutcomeUnknownError);
        expect((caught as TransactionOutcomeUnknownError).txHash).toBe(TX_HASH);
        expect((caught as TransactionOutcomeUnknownError).operation).toBe(
          "run-script"
        );
      } finally {
        await harness.cleanup();
      }
    });

    it("tolerates a movelite-shaped response missing success/vm_status", async () => {
      const scriptPath = writeCompiledScript();
      const aptos = makeMockAptos({ type: "user_transaction" });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        const result = await harness.runMoveScript({
          scriptPath,
          sdkExecute: true,
        });
        expect(result).toEqual({ txHash: TX_HASH });
      } finally {
        await harness.cleanup();
      }
    });

    it("defaults to the CLI path when sdkExecute is not set (live harness)", async () => {
      const scriptPath = writeCompiledScript();
      const { adapter, calls } = makeAdapter({
        exitCode: 0,
        stdout: successStdout(),
        stderr: "",
      });
      const aptos = makeMockAptos({ success: true });

      const harness = await Harness.createLive("testnet");
      try {
        (harness.runtime as { aptos: unknown }).aptos = aptos;
        await harness.runMoveScript({ scriptPath, adapter });
        expect(calls).toHaveLength(1);
        expect(aptos.transaction.build.simple).not.toHaveBeenCalled();
      } finally {
        await harness.cleanup();
      }
    });
  });
});
