import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the helper before importing the command — vi.mock is hoisted.
const runMoveTestsMock = vi.fn();
vi.mock("../../helpers/move-tests.js", () => ({
  runMoveTests: runMoveTestsMock,
}));

const { default: testMoveCommand } = await import("../test-move.js");

describe("testMoveCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runMoveTestsMock.mockReset();
    // Intercept process.exit so the test process keeps running.
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 0 on a successful move-tests run and forwards options", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);

    await testMoveCommand({ filter: "counter", ignoreWarnings: true });

    expect(runMoveTestsMock).toHaveBeenCalledTimes(1);
    expect(runMoveTestsMock).toHaveBeenCalledWith({
      filter: "counter",
      ignoreWarnings: true,
      skipIfMissing: false,
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("defaults options to undefined when none are provided", async () => {
    runMoveTestsMock.mockResolvedValueOnce(undefined);

    await testMoveCommand();

    const callArg = runMoveTestsMock.mock.calls[0]![0];
    expect(callArg).toEqual({
      filter: undefined,
      ignoreWarnings: undefined,
      skipIfMissing: false,
    });
  });

  it("exits 1 and logs the error message when the helper throws", async () => {
    runMoveTestsMock.mockRejectedValueOnce(new Error("move compile failed"));

    await testMoveCommand({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("Move tests failed")
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("move compile failed")
    );
  });

  it("handles non-Error throws (string) without crashing", async () => {
    runMoveTestsMock.mockRejectedValueOnce("just a string");

    await testMoveCommand({});

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("just a string")
    );
  });
});
