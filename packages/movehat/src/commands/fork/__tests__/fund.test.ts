import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const forkManagerLoad = vi.fn();
const forkManagerFundAccount = vi.fn();
const forkManagerGetResource = vi.fn();
const ForkManagerCtor = vi.fn();

vi.mock("../../../fork/manager.js", () => ({
  ForkManager: class {
    constructor(forkPath: string) {
      ForkManagerCtor(forkPath);
    }
    load = forkManagerLoad;
    fundAccount = forkManagerFundAccount;
    getResource = forkManagerGetResource;
  },
}));

const { default: forkFundCommand } = await import("../fund.js");

describe("forkFundCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    forkManagerLoad.mockReset();
    forkManagerFundAccount.mockReset().mockResolvedValue(undefined);
    forkManagerGetResource.mockReset().mockResolvedValue({
      coin: { value: "1000" },
    });
    ForkManagerCtor.mockReset();
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 1 when --account is missing", async () => {
    await expect(
      forkFundCommand({ account: "", amount: "100" } as never)
    ).rejects.toThrow("__test_exit_1__");
    expect(forkManagerFundAccount).not.toHaveBeenCalled();
  });

  it("exits 1 when --amount is missing", async () => {
    await expect(
      forkFundCommand({ account: "0xabc", amount: "" } as never)
    ).rejects.toThrow("__test_exit_1__");
    expect(forkManagerFundAccount).not.toHaveBeenCalled();
  });

  it("exits 1 when --amount is not a positive integer", async () => {
    await expect(
      forkFundCommand({ account: "0xabc", amount: "abc" } as never)
    ).rejects.toThrow("__test_exit_1__");
    await expect(
      forkFundCommand({ account: "0xabc", amount: "-5" } as never)
    ).rejects.toThrow("__test_exit_1__");
  });

  it("happy path: loads fork, funds the account, prints new balance", async () => {
    await forkFundCommand({
      account: "0xabc",
      amount: "1000",
      fork: "/tmp/fork",
    } as never);

    expect(forkManagerLoad).toHaveBeenCalledTimes(1);
    expect(forkManagerFundAccount).toHaveBeenCalledWith(
      "0xabc",
      1000,
      "0x1::aptos_coin::AptosCoin"
    );
    expect(forkManagerGetResource).toHaveBeenCalled();
  });

  it("respects --coinType when provided", async () => {
    await forkFundCommand({
      account: "0xabc",
      amount: "1000",
      coinType: "0x99::custom::Coin",
    } as never);

    expect(forkManagerFundAccount).toHaveBeenCalledWith(
      "0xabc",
      1000,
      "0x99::custom::Coin"
    );
  });

  it("exits 1 when fundAccount throws", async () => {
    forkManagerFundAccount.mockRejectedValueOnce(new Error("fund failed"));

    await expect(
      forkFundCommand({ account: "0xabc", amount: "1000" } as never)
    ).rejects.toThrow("__test_exit_1__");
  });
});
