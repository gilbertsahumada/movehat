import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fetchLatestVersionMock = vi.fn();
const promptsMock = vi.fn();
const runCliMock = vi.fn();

vi.mock("../../helpers/npm-registry.js", () => ({
  fetchLatestVersion: fetchLatestVersionMock,
}));

vi.mock("prompts", () => ({
  default: promptsMock,
}));

vi.mock("../../utils/runCli.js", () => ({
  runCli: runCliMock,
}));

const { default: updateCommand } = await import("../update.js");

describe("updateCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchLatestVersionMock.mockReset();
    promptsMock.mockReset();
    runCliMock.mockReset();
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((_code?: number) => undefined) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing further when already on the latest version", async () => {
    // Read the actual current version from package.json — same fetch the
    // command does internally — and report it back as the "latest".
    const currentVersion = await import("../../../package.json", {
      with: { type: "json" },
    }).then((m) => m.default.version);
    fetchLatestVersionMock.mockResolvedValueOnce(currentVersion);

    await updateCommand();

    expect(fetchLatestVersionMock).toHaveBeenCalledTimes(1);
    // Prompt never fires because the command short-circuits on the
    // "already up to date" branch.
    expect(promptsMock).not.toHaveBeenCalled();
    expect(runCliMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 with a clear error when fetchLatestVersion returns null", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce(null);

    await updateCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prompts for confirmation, runs the package manager, and exits 0 on success", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await updateCommand();

    expect(promptsMock).toHaveBeenCalledTimes(1);
    expect(runCliMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("returns without running the package manager when the user declines the prompt", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: false });

    await updateCommand();

    expect(runCliMock).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("returns without running the package manager when the user Ctrl+Cs the prompt", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    // Prompt with Ctrl+C returns an empty object — `confirm` is undefined.
    promptsMock.mockResolvedValueOnce({});

    await updateCommand();

    expect(runCliMock).not.toHaveBeenCalled();
  });

  it("exits 1 when the package-manager run returns a non-zero exit code", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "permission denied",
    });

    await updateCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when the package-manager run throws", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockRejectedValueOnce(new Error("ENOENT: pnpm not found"));

    await updateCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 with a clear error when fetchLatestVersion throws", async () => {
    fetchLatestVersionMock.mockRejectedValueOnce(new Error("network down"));

    await updateCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("updateCommand — package-manager detection", () => {
  let tmpCwd: string;
  let origCwd: string;
  let origAgent: string | undefined;

  beforeEach(() => {
    fetchLatestVersionMock.mockReset();
    promptsMock.mockReset();
    runCliMock.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-update-pkgmgr-"));
    process.chdir(tmpCwd);
    origAgent = process.env.npm_config_user_agent;
    delete process.env.npm_config_user_agent;
    // npm_execpath is also inspected by detectPackageManager — clear it
    // so the test doesn't pick up the runner's own value.
    delete process.env.npm_execpath;
    vi.spyOn(process, "exit").mockImplementation(((_code?: number) => undefined) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origAgent === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = origAgent;
    rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("detects pnpm when pnpm-lock.yaml is present and runs `pnpm add -g`", async () => {
    writeFileSync(join(tmpCwd, "pnpm-lock.yaml"), "");
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await updateCommand();

    const call = runCliMock.mock.calls[0]!;
    expect(call[0].command).toBe("pnpm");
    expect(call[0].args.slice(0, 2)).toEqual(["add", "-g"]);
  });

  it("detects yarn when yarn.lock is present and runs `yarn global upgrade`", async () => {
    writeFileSync(join(tmpCwd, "yarn.lock"), "");
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await updateCommand();

    const call = runCliMock.mock.calls[0]!;
    expect(call[0].command).toBe("yarn");
    expect(call[0].args.slice(0, 2)).toEqual(["global", "upgrade"]);
  });

  it("detects npm when package-lock.json is present and runs `npm update -g`", async () => {
    writeFileSync(join(tmpCwd, "package-lock.json"), "{}");
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await updateCommand();

    const call = runCliMock.mock.calls[0]!;
    expect(call[0].command).toBe("npm");
    expect(call[0].args.slice(0, 2)).toEqual(["update", "-g"]);
  });

  it("falls back to user-agent detection when no lockfile is present (pnpm)", async () => {
    process.env.npm_config_user_agent = "pnpm/8.0.0 node/v20";
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await updateCommand();

    expect(runCliMock.mock.calls[0]![0].command).toBe("pnpm");
  });

  it("defaults to npm when neither lockfile nor user-agent gives a hint", async () => {
    fetchLatestVersionMock.mockResolvedValueOnce("99.0.0");
    promptsMock.mockResolvedValueOnce({ confirm: true });
    runCliMock.mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" });

    await updateCommand();

    expect(runCliMock.mock.calls[0]![0].command).toBe("npm");
  });
});
