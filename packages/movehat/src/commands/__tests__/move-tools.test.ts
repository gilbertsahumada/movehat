import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { loadUserConfigMock, runCliMock, runCliUntilInterruptedMock } = vi.hoisted(() => ({
  loadUserConfigMock: vi.fn(),
  runCliMock: vi.fn(),
  runCliUntilInterruptedMock: vi.fn(),
}));

vi.mock("../../core/config.js", () => ({ loadUserConfig: loadUserConfigMock }));
vi.mock("../../utils/runCli.js", () => ({
  runCli: runCliMock,
  runCliUntilInterrupted: runCliUntilInterruptedMock,
}));

const { default: lintCommand } = await import("../lint.js");
const { default: proveCommand } = await import("../prove.js");
const { default: coverageCommand } = await import("../coverage.js");

describe("Movement CLI quality commands", () => {
  let root: string;
  let packageDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "movehat-tools-"));
    packageDir = join(root, "move package safe");
    mkdirSync(packageDir);
    loadUserConfigMock.mockReset();
    loadUserConfigMock.mockResolvedValue({ moveDir: packageDir });
    runCliMock.mockReset();
    runCliMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    runCliUntilInterruptedMock.mockReset();
    runCliUntilInterruptedMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("passes a space-containing package path as one lint argument", async () => {
    await lintCommand();

    expect(runCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "movement",
        args: ["move", "lint", "--package-dir", packageDir, "--dev"],
        timeoutMs: 5 * 60 * 1000,
      }),
      { throwOnNonZeroExit: false }
    );
  });

  it("fails closed on a package path containing shell metacharacters", async () => {
    const unsafeDir = join(root, "move package (unsafe)");
    mkdirSync(unsafeDir);
    loadUserConfigMock.mockResolvedValue({ moveDir: unsafeDir });

    await expect(lintCommand()).rejects.toThrow(/dangerous characters/);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("runs the Move Prover without a timeout", async () => {
    await proveCommand();
    expect(runCliUntilInterruptedMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        args: ["move", "prove", "--package-dir", packageDir, "--dev"],
        timeoutMs: Infinity,
      })
    );
  });

  it("treats an interrupted prover as a clean user cancellation", async () => {
    runCliUntilInterruptedMock.mockResolvedValueOnce({
      exitCode: -1,
      signal: "SIGTERM",
      interruptedByParent: "SIGINT",
      stdout: "",
      stderr: "",
    });

    await expect(proveCommand()).resolves.toBeUndefined();
  });

  it("rejects a prover terminated by a child-only signal", async () => {
    runCliUntilInterruptedMock.mockResolvedValueOnce({
      exitCode: -1,
      signal: "SIGKILL",
      stdout: "",
      stderr: "",
    });

    await expect(proveCommand()).rejects.toThrow(
      "movement move prove terminated by SIGKILL"
    );
  });

  it("runs covered tests before the coverage summary and forwards filters", async () => {
    await coverageCommand("increment");

    expect(runCliMock.mock.calls[0]![0].args).toEqual([
      "move",
      "test",
      "--package-dir",
      packageDir,
      "--dev",
      "--coverage",
      "--filter",
      "increment",
    ]);
    expect(runCliMock.mock.calls[1]![0].args).toEqual([
      "move",
      "coverage",
      "summary",
      "--package-dir",
      packageDir,
    ]);
    expect(runCliMock.mock.calls[0]![0].timeoutMs).toBe(30 * 60 * 1000);
    expect(runCliMock.mock.calls[1]![0].timeoutMs).toBe(5 * 60 * 1000);
  });

  it("propagates a non-zero Movement CLI result", async () => {
    runCliMock.mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "" });
    await expect(lintCommand()).rejects.toThrow(
      "movement move lint exited with code 2"
    );
  });
});
