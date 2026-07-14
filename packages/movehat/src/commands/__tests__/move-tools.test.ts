import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { loadUserConfigMock, runCliMock } = vi.hoisted(() => ({
  loadUserConfigMock: vi.fn(),
  runCliMock: vi.fn(),
}));

vi.mock("../../core/config.js", () => ({ loadUserConfig: loadUserConfigMock }));
vi.mock("../../core/shell.js", () => ({
  validatePathSafety: (value: string) => value,
}));
vi.mock("../../utils/runCli.js", () => ({ runCli: runCliMock }));

const { default: lintCommand } = await import("../lint.js");
const { default: proveCommand } = await import("../prove.js");
const { default: coverageCommand } = await import("../coverage.js");

describe("Movement CLI quality commands", () => {
  let root: string;
  let packageDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "movehat tools $() "));
    packageDir = join(root, "move package (safe)");
    mkdirSync(packageDir);
    loadUserConfigMock.mockReset();
    loadUserConfigMock.mockResolvedValue({ moveDir: packageDir });
    runCliMock.mockReset();
    runCliMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("passes a metacharacter-containing package path as one lint argument", async () => {
    await lintCommand();

    expect(runCliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "movement",
        args: ["move", "lint", "--package-dir", packageDir],
      }),
      { throwOnNonZeroExit: false }
    );
  });

  it("runs the Move Prover through the same spawn-safe boundary", async () => {
    await proveCommand();
    expect(runCliMock.mock.calls[0]![0].args).toEqual([
      "move",
      "prove",
      "--package-dir",
      packageDir,
    ]);
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
  });

  it("propagates a non-zero Movement CLI result", async () => {
    runCliMock.mockResolvedValueOnce({ exitCode: 2, stdout: "", stderr: "" });
    await expect(lintCommand()).rejects.toThrow(
      "movement move lint exited with code 2"
    );
  });
});
