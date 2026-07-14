import { beforeEach, describe, expect, it, vi } from "vitest";

const setupLocalTestingMock = vi.fn();

vi.mock("../../helpers/setupLocalTesting.js", () => ({
  setupLocalTesting: setupLocalTestingMock,
}));

vi.mock("../../harness/proxy.js", () => ({
  createHarnessProxy: (target: unknown) => target,
  createForkContractProxy: (target: unknown) => target,
}));

const { Harness } = await import("../../harness/Harness.js");

describe("Harness.createFork options", () => {
  beforeEach(() => {
    setupLocalTestingMock.mockReset().mockResolvedValue({
      runtime: {
        accountManager: { getLabeledAccounts: () => ({}) },
        getContract: vi.fn(),
      },
    });
  });

  it("keeps the positional API backward compatible", async () => {
    await Harness.createFork("mainnet", "token", "https://rpc.example/v1");

    expect(setupLocalTestingMock).toHaveBeenCalledWith({
      mode: "fork",
      forkNetwork: "mainnet",
      forkApiKey: "token",
      forkRpcUrl: "https://rpc.example/v1",
    });
  });

  it("maps the options object to fork setup and defaults to testnet", async () => {
    await Harness.createFork({
      name: "payments",
      port: 8090,
      resetState: false,
      accountLabels: ["alice"],
    });

    expect(setupLocalTestingMock).toHaveBeenCalledWith({
      mode: "fork",
      forkNetwork: "testnet",
      forkName: "payments",
      forkPort: 8090,
      forkResetState: false,
      accountLabels: ["alice"],
    });
  });
});
