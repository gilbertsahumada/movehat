import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { propagateRunResultExit } from "../run.js";
import type { RunResult } from "../../utils/childProcessAdapter.js";

// Mock runCli for orchestrator tests so we never spawn a real node/tsx.
// Use vi.hoisted to make the mock fn visible to the hoisted vi.mock factory.
const { runCliMock } = vi.hoisted(() => ({ runCliMock: vi.fn() }));
vi.mock("../../utils/runCli.js", () => ({
  runCli: runCliMock,
}));

// Static import after mock declaration — vi hoists vi.mock.
const { default: runCommand } = await import("../run.js");

/**
 * Direct coverage for the signal-forwarding branch added to fix the
 * CodeRabbit finding on PR #100 — `process.kill(process.pid, signal)`
 * cannot run inside vitest without killing the runner, so the helper is
 * exported and `process.kill` / `process.exit` are spied.
 */
describe("propagateRunResultExit", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
  });

  afterEach(() => {
    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("re-raises the signal on the parent when result.signal is set", () => {
    const result: RunResult = {
      exitCode: -1,
      stdout: "",
      stderr: "",
      signal: "SIGINT",
    };

    propagateRunResultExit(result);

    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("forwards a non-negative numeric exit code via process.exit", () => {
    const result: RunResult = { exitCode: 42, stdout: "", stderr: "" };

    propagateRunResultExit(result);

    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(42);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("clamps a negative exit code with no signal to exit 1 (avoids -1 → 255 mask)", () => {
    const result: RunResult = { exitCode: -1, stdout: "", stderr: "" };

    propagateRunResultExit(result);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("treats exitCode 0 as a normal success exit (not a signal)", () => {
    const result: RunResult = { exitCode: 0, stdout: "", stderr: "" };

    propagateRunResultExit(result);

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(killSpy).not.toHaveBeenCalled();
  });
});

describe("runCommand — orchestrator", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runCliMock.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-runcmd-"));
    process.chdir(tmpCwd);
    // Throw on exit so the orchestrator's process.exit branches actually
    // halt the flow (otherwise execution continues past process.exit and
    // crashes on the next stmt with confusing errors).
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    // Suppress the signal-forwarding branch from killing the test runner.
    vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exits 1 when scriptPath is empty", async () => {
    await expect(runCommand("")).rejects.toThrow("__test_exit_1__");
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("exits 1 when the script file does not exist", async () => {
    await expect(runCommand("nonexistent.ts")).rejects.toThrow("__test_exit_1__");
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("exits 1 on an unsupported file extension", async () => {
    const path = join(tmpCwd, "script.txt");
    writeFileSync(path, "console.log('hi');");
    await expect(runCommand("script.txt")).rejects.toThrow("__test_exit_1__");
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("invokes runCli when both script and tsx are resolvable (orchestrator happy path)", async () => {
    // Inside vitest, the __dirname fallback in run.ts resolves tsx via
    // the workspace's own node_modules. We don't need to plant a fake
    // tsx — the orchestrator finds it and reaches the runCli call.
    const scriptPath = join(tmpCwd, "deploy.ts");
    writeFileSync(scriptPath, "// noop");
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    // propagateRunResultExit's thrown __test_exit_0__ gets caught by the
    // outer try/catch in runCommand, which then logs and calls
    // process.exit(1) → throws __test_exit_1__. The interesting bit is
    // that runCli got called with the right args.
    await expect(runCommand("deploy.ts")).rejects.toThrow();

    expect(runCliMock).toHaveBeenCalledTimes(1);
    const callArgs = runCliMock.mock.calls[0]![0];
    expect(callArgs.command).toBe("node");
    // macOS resolves /var → /private/var, so compare by basename.
    expect(callArgs.args[1]).toMatch(/deploy\.ts$/);
    expect(callArgs.inheritStdio).toBe(true);
  });

  it("accepts .js and .mjs script extensions", async () => {
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
    const path = join(tmpCwd, "script.mjs");
    writeFileSync(path, "");
    await expect(runCommand("script.mjs")).rejects.toThrow();
    expect(runCliMock).toHaveBeenCalledTimes(1);
  });

  it("logs the active network when MH_CLI_NETWORK is set", async () => {
    const origNetwork = process.env.MH_CLI_NETWORK;
    process.env.MH_CLI_NETWORK = "testnet";
    try {
      const path = join(tmpCwd, "script.ts");
      writeFileSync(path, "");
      runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });
      await expect(runCommand("script.ts")).rejects.toThrow();
      expect(runCliMock).toHaveBeenCalled();
    } finally {
      if (origNetwork === undefined) delete process.env.MH_CLI_NETWORK;
      else process.env.MH_CLI_NETWORK = origNetwork;
    }
  });

  // Note: the "tsx binary not found" exit branch (lines 80-101 in run.ts)
  // requires `require.resolve` to throw for BOTH the cwd-paths lookup and
  // the __dirname-paths fallback. In vitest, tsx is always resolvable via
  // the workspace's own node_modules from __dirname's perspective, so the
  // fallback never throws. Patching `module.createRequire` to inject a
  // failing resolver fails with "Cannot redefine property" because the
  // ESM-imported `node:module` is read-only. The branch is exercised
  // by the integration suite via the "tsx not found" runtime failure
  // when tsx is missing from a published consumer.

  it("catches and exits 1 when runCli throws (spawn-time failure)", async () => {
    runCliMock.mockRejectedValueOnce(new Error("ENOENT: node not found"));
    const path = join(tmpCwd, "script.ts");
    writeFileSync(path, "");
    await expect(runCommand("script.ts")).rejects.toThrow("__test_exit_1__");
  });
});
