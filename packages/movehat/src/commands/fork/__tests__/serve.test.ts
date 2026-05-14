import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const serverStart = vi.fn();
const serverStop = vi.fn();
const ForkServerCtor = vi.fn();
const loadUserConfigMock = vi.fn();

vi.mock("../../../fork/server.js", () => ({
  ForkServer: class {
    constructor(forkPath: string, port: number, host: string) {
      ForkServerCtor(forkPath, port, host);
    }
    start = serverStart;
    stop = serverStop;
  },
}));

vi.mock("../../../core/config.js", () => ({
  loadUserConfig: loadUserConfigMock,
}));

const { default: forkServeCommand } = await import("../serve.js");

describe("forkServeCommand", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    serverStart.mockReset().mockResolvedValue(undefined);
    serverStop.mockReset().mockResolvedValue(undefined);
    ForkServerCtor.mockReset();
    loadUserConfigMock.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-forkserve-"));
    process.chdir(tmpCwd);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("happy path: starts server with explicit fork path + default port/host", async () => {
    const forkPath = join(tmpCwd, "myfork");
    mkdirSync(forkPath, { recursive: true });
    writeFileSync(join(forkPath, "metadata.json"), "{}");

    await forkServeCommand({ fork: forkPath });

    expect(ForkServerCtor).toHaveBeenCalledWith(forkPath, 8080, "127.0.0.1");
    expect(serverStart).toHaveBeenCalledTimes(1);
  });

  it("respects --port and --host overrides", async () => {
    const forkPath = join(tmpCwd, "myfork");
    mkdirSync(forkPath, { recursive: true });
    writeFileSync(join(forkPath, "metadata.json"), "{}");

    await forkServeCommand({ fork: forkPath, port: 9999, host: "0.0.0.0" });

    expect(ForkServerCtor).toHaveBeenCalledWith(forkPath, 9999, "0.0.0.0");
  });

  it("resolves fork path from defaultNetwork when --fork is omitted", async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      defaultNetwork: "testnet",
      networks: { testnet: { url: "x", chainId: "testnet" } },
    });
    const expectedPath = join(tmpCwd, ".movehat", "forks", "testnet-fork");
    mkdirSync(expectedPath, { recursive: true });
    writeFileSync(join(expectedPath, "metadata.json"), "{}");

    await forkServeCommand({});

    // macOS /var → /private/var symlink — match by suffix.
    const passedPath = ForkServerCtor.mock.calls[0]![0] as string;
    expect(passedPath).toMatch(/\.movehat\/forks\/testnet-fork$/);
  });

  it("exits 1 when the fork's metadata.json is missing", async () => {
    const forkPath = join(tmpCwd, "missing-fork");

    await expect(forkServeCommand({ fork: forkPath })).rejects.toThrow(
      "__test_exit_1__"
    );
    expect(serverStart).not.toHaveBeenCalled();
  });

  it("exits 1 when the configured network is unknown", async () => {
    loadUserConfigMock.mockResolvedValueOnce({
      defaultNetwork: "ghost",
      networks: {},
    });

    await expect(forkServeCommand({})).rejects.toThrow("__test_exit_1__");
    expect(serverStart).not.toHaveBeenCalled();
  });

  it("exits 1 when server.start throws", async () => {
    const forkPath = join(tmpCwd, "myfork");
    mkdirSync(forkPath, { recursive: true });
    writeFileSync(join(forkPath, "metadata.json"), "{}");
    serverStart.mockRejectedValueOnce(new Error("EADDRINUSE"));

    await expect(forkServeCommand({ fork: forkPath })).rejects.toThrow(
      "__test_exit_1__"
    );
  });
});
