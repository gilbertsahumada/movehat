import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const forkManagerLoad = vi.fn();
const forkManagerGetResource = vi.fn();
const ForkManagerCtor = vi.fn();

vi.mock("../../../fork/manager.js", () => ({
  ForkManager: class {
    constructor(forkPath: string) {
      ForkManagerCtor(forkPath);
    }
    load = forkManagerLoad;
    getResource = forkManagerGetResource;
  },
}));

const { default: forkViewResourceCommand } = await import("../view-resource.js");

describe("forkViewResourceCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    forkManagerLoad.mockReset();
    forkManagerGetResource.mockReset();
    ForkManagerCtor.mockReset();
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 1 when --account is missing", async () => {
    await expect(
      forkViewResourceCommand({
        account: "",
        resource: "0x1::aptos_coin::AptosCoin",
      } as never)
    ).rejects.toThrow("__test_exit_1__");
    expect(forkManagerLoad).not.toHaveBeenCalled();
  });

  it("exits 1 when --resource is missing", async () => {
    await expect(
      forkViewResourceCommand({
        account: "0xabc",
        resource: "",
      } as never)
    ).rejects.toThrow("__test_exit_1__");
    expect(forkManagerLoad).not.toHaveBeenCalled();
  });

  it("happy path: loads the fork, fetches the resource, JSON-pretty-prints it", async () => {
    forkManagerGetResource.mockResolvedValueOnce({ coin: { value: "1000" } });

    await forkViewResourceCommand({
      account: "0xabc",
      resource: "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>",
      fork: "/tmp/fork",
    } as never);

    expect(forkManagerLoad).toHaveBeenCalledTimes(1);
    expect(forkManagerGetResource).toHaveBeenCalledWith(
      "0xabc",
      "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
    );
    // Pretty-printed JSON appears in stdout.
    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toContain("1000");
  });

  it("defaults forkPath to <cwd>/.movehat/forks/testnet-fork when --fork is omitted", async () => {
    forkManagerGetResource.mockResolvedValueOnce({});

    await forkViewResourceCommand({
      account: "0xabc",
      resource: "0x1::a::B",
    } as never);

    const passed = ForkManagerCtor.mock.calls[0]![0] as string;
    expect(passed).toMatch(/\.movehat\/forks\/testnet-fork$/);
  });

  it("exits 1 when getResource throws (resource not found)", async () => {
    forkManagerGetResource.mockRejectedValueOnce(new Error("not found"));

    await expect(
      forkViewResourceCommand({
        account: "0xabc",
        resource: "0x1::missing::X",
      } as never)
    ).rejects.toThrow("__test_exit_1__");
  });
});
