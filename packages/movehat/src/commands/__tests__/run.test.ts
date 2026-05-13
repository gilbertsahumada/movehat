import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { propagateRunResultExit } from "../run.js";
import type { RunResult } from "../../utils/childProcessAdapter.js";

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
