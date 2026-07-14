import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Harness } from "../../harness/index.js";
import { CliExecutionError } from "../../errors.js";
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

  it("honors packageDir as the CLI working directory", async () => {
    const packageDir = join(fixture.tmpCwd, "Work (Client)");
    const scriptPath = join(packageDir, "scripts", "init.move");
    mkdirSync(join(packageDir, "scripts"), { recursive: true });
    writeFileSync(scriptPath, "// dummy move script\n");
    const { adapter, calls } = makeAdapter({
      exitCode: 0,
      stdout: successStdout(),
      stderr: "",
    });

    const harness = await Harness.createLive("testnet");
    try {
      await harness.runMoveScript({ scriptPath, packageDir, adapter });
      expect(calls[0]?.cwd).toBe(packageDir);
      expect(calls[0]?.args).toContain(scriptPath);
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
});
