import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runMoveTestsMock = vi.fn();
const runCliMock = vi.fn();
const promptsMock = vi.fn();
const coverageCommandMock = vi.fn();

vi.mock("../../helpers/move-tests.js", () => ({
  runMoveTests: runMoveTestsMock,
}));

vi.mock("../../utils/runCli.js", () => ({
  runCli: runCliMock,
}));

vi.mock("prompts", () => ({
  default: promptsMock,
}));

vi.mock("../coverage.js", () => ({
  default: coverageCommandMock,
}));

const { default: testCommand } = await import("../test.js");

describe("testCommand — flag dispatch", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMoveTestsMock.mockReset();
    runCliMock.mockReset();
    promptsMock.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-testcmd-"));
    process.chdir(tmpCwd);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("--move flag runs only the Move test path", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);

    await testCommand({ move: true });

    expect(runMoveTestsMock).toHaveBeenCalledTimes(1);
    expect(runMoveTestsMock).toHaveBeenCalledWith({
      filter: undefined,
      skipIfMissing: false,
    });
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("legacy --moveOnly flag is translated into --move", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);

    await testCommand({ moveOnly: true });

    expect(runMoveTestsMock).toHaveBeenCalledTimes(1);
  });

  it("legacy --tsOnly flag is translated into --ts (skips Move; mocha branch missing tests/ → skip)", async () => {
    // No tests/ directory exists in tmpCwd, so the TS-only path skips
    // gracefully via the "No TypeScript tests found" branch and never
    // invokes runCli. The Move path is never entered.
    await testCommand({ tsOnly: true });

    expect(runMoveTestsMock).not.toHaveBeenCalled();
    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("--all flag forces the all-tests path", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);
    await testCommand({ all: true });
    expect(runMoveTestsMock).toHaveBeenCalledTimes(1);
    // skipIfMissing: true in the all-tests path.
    expect(runMoveTestsMock.mock.calls[0]![0].skipIfMissing).toBe(true);
  });

  it("--move + --ts together also resolves to 'all'", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);
    await testCommand({ move: true, ts: true });
    // The 'all' path uses skipIfMissing: true.
    expect(runMoveTestsMock.mock.calls[0]![0].skipIfMissing).toBe(true);
  });

  it("--coverage uses the Movement coverage runner", async () => {
    coverageCommandMock.mockResolvedValueOnce(undefined);
    await testCommand({ coverage: true, filter: "counter" });
    expect(coverageCommandMock).toHaveBeenCalledWith("counter");
    expect(runMoveTestsMock).not.toHaveBeenCalled();
  });

  it("rejects coverage in watch mode", async () => {
    await expect(testCommand({ coverage: true, watch: true })).rejects.toThrow(
      "--coverage cannot be combined with --watch"
    );
  });

  it("Move-only path exits 1 when runMoveTests throws", async () => {
    runMoveTestsMock.mockRejectedValueOnce(new Error("compile failed"));
    await testCommand({ move: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("forwards --filter to runMoveTests", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);
    await testCommand({ move: true, filter: "counter" });
    expect(runMoveTestsMock.mock.calls[0]![0].filter).toBe("counter");
  });
});

describe("testCommand — interactive menu", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMoveTestsMock.mockReset();
    runCliMock.mockReset();
    promptsMock.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-testcmd-"));
    process.chdir(tmpCwd);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("falls back to interactive prompt in a TTY; cancellation exits 0", async () => {
    // Ctrl+C — prompt returns {}.
    promptsMock.mockResolvedValueOnce({});

    await testCommand({ interactive: true });

    expect(promptsMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("prompt returns 'move' → runs the Move path", async () => {
    promptsMock.mockResolvedValueOnce({ testType: "move" });
    runMoveTestsMock.mockResolvedValueOnce(undefined);

    await testCommand({ interactive: true });

    expect(runMoveTestsMock).toHaveBeenCalledTimes(1);
  });

  it("runs all tests without prompting in non-interactive environments", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);

    await testCommand({ interactive: false });

    expect(promptsMock).not.toHaveBeenCalled();
    expect(runMoveTestsMock).toHaveBeenCalledWith({
      filter: undefined,
      skipIfMissing: true,
    });
  });
});

describe("testCommand — TypeScript path with tests/ + node_modules", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMoveTestsMock.mockReset();
    runCliMock.mockReset();
    promptsMock.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-testcmd-"));
    process.chdir(tmpCwd);

    // Plant a tests/ directory and a fake mocha binary.
    mkdirSync(join(tmpCwd, "tests"), { recursive: true });
    mkdirSync(join(tmpCwd, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(tmpCwd, "node_modules", ".bin", "mocha"), "#!/bin/sh\nexit 0\n");

    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("--ts invokes mocha via runCli when both tests/ and node_modules/.bin/mocha exist", async () => {
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await testCommand({ ts: true });

    expect(runCliMock).toHaveBeenCalledTimes(1);
    expect(runCliMock.mock.calls[0]![0].command).toContain("mocha");
  });

  it("--ts exits 1 when mocha's exit code is non-zero", async () => {
    runCliMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "1 failing",
    });

    await testCommand({ ts: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
