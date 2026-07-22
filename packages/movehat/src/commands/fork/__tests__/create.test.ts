import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const promptsMock = vi.fn();
const forkManagerInitialize = vi.fn();
const forkManagerGetMetadata = vi.fn();
const ForkManagerCtor = vi.fn();
const loadUserConfigMock = vi.fn();
const resolveNetworkEndpointMock = vi.fn();

vi.mock("prompts", () => ({ default: promptsMock }));

vi.mock("../../../fork/manager.js", () => ({
  ForkManager: class {
    constructor(forkPath: string) {
      ForkManagerCtor(forkPath);
    }
    initialize = forkManagerInitialize;
    getMetadata = forkManagerGetMetadata;
  },
}));

vi.mock("../../../core/config.js", () => ({
  loadUserConfig: loadUserConfigMock,
  resolveNetworkEndpoint: resolveNetworkEndpointMock,
  sanitizeUrlForLog: (url: string) => url,
}));

const { default: forkCreateCommand, validateForkName } = await import("../create.js");

describe("forkCreateCommand", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    promptsMock.mockReset();
    forkManagerInitialize.mockReset().mockResolvedValue(undefined);
    forkManagerGetMetadata.mockReset().mockReturnValue({
      network: "testnet",
      nodeUrl: "https://testnet.movementnetwork.xyz/v1",
      chainId: 27,
      ledgerVersion: "100",
      timestamp: "12345",
      epoch: "5",
      blockHeight: "42",
      createdAt: new Date(0).toISOString(),
    });
    ForkManagerCtor.mockReset();
    loadUserConfigMock.mockReset().mockResolvedValue({
      defaultNetwork: "testnet",
      networks: { testnet: { url: "https://testnet.movementnetwork.xyz/v1", chainId: "testnet" } },
    });
    resolveNetworkEndpointMock.mockReset().mockReturnValue({
      network: "testnet",
      networkConfig: { url: "https://testnet.movementnetwork.xyz/v1", chainId: "testnet" },
    });

    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-forkcreate-"));
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

  it("happy path: initializes a fresh fork at the default path", async () => {
    await forkCreateCommand({ network: "testnet" });

    expect(forkManagerInitialize).toHaveBeenCalledTimes(1);
    expect(forkManagerInitialize).toHaveBeenCalledWith(
      "https://testnet.movementnetwork.xyz/v1",
      "testnet"
    );
    expect(promptsMock).not.toHaveBeenCalled();
  });

  it("uses a custom fork name and path when provided", async () => {
    const customPath = join(tmpCwd, "my-custom-fork");
    await forkCreateCommand({ network: "testnet", path: customPath, name: "ignored-when-path-set" });

    expect(ForkManagerCtor).toHaveBeenCalledWith(customPath);
  });

  it("accepts safe fork names and rejects path-like names", () => {
    expect(validateForkName("testnet-fork_1.2")).toBe("testnet-fork_1.2");

    for (const unsafe of ["", ".", "..", "../prod", "prod/secret", "prod\\secret", "prod..secret", "prod secret"]) {
      expect(() => validateForkName(unsafe)).toThrow("Invalid fork name");
    }
  });

  it("exits 1 before initialization when --name is not a safe basename", async () => {
    await expect(forkCreateCommand({ network: "testnet", name: "../prod" })).rejects.toThrow(
      "__test_exit_1__"
    );

    expect(ForkManagerCtor).not.toHaveBeenCalled();
    expect(forkManagerInitialize).not.toHaveBeenCalled();
  });

  it("prompts for overwrite when the fork directory already exists", async () => {
    const forkPath = join(tmpCwd, ".movehat", "forks", "testnet-fork");
    mkdirSync(forkPath, { recursive: true });
    promptsMock.mockResolvedValueOnce({ overwrite: true });

    await forkCreateCommand({ network: "testnet" });

    expect(promptsMock).toHaveBeenCalledTimes(1);
    expect(forkManagerInitialize).toHaveBeenCalledTimes(1);
  });

  it("aborts gracefully when the user declines the overwrite prompt", async () => {
    const forkPath = join(tmpCwd, ".movehat", "forks", "testnet-fork");
    mkdirSync(forkPath, { recursive: true });
    promptsMock.mockResolvedValueOnce({ overwrite: false });

    await forkCreateCommand({ network: "testnet" });

    expect(forkManagerInitialize).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits 1 when the manager's initialize throws", async () => {
    forkManagerInitialize.mockRejectedValueOnce(new Error("upstream is unreachable"));

    await expect(forkCreateCommand({ network: "testnet" })).rejects.toThrow(
      "__test_exit_1__"
    );
  });
});
