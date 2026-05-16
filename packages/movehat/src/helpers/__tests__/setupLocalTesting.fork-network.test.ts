import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * F1 — Harness.createFork(network) must honor the requested network.
 *
 * Mocks ForkManager so we can capture which RPC URL the fresh-fork
 * code path picks. Strategy mirrors the pattern in
 * src/fork/__tests__/manager.test.ts: replace the manager module with
 * a stub that records every call to `initialize`.
 */

interface InitCall {
  nodeUrl: string;
  networkName?: string;
  apiKey?: string;
}
const initializeCalls: InitCall[] = [];

vi.mock("../../fork/manager.js", () => {
  return {
    ForkManager: class {
      constructor(_forkPath: string) {}
      async initialize(nodeUrl: string, networkName?: string, apiKey?: string) {
        const entry: InitCall = { nodeUrl };
        if (networkName !== undefined) entry.networkName = networkName;
        if (apiKey !== undefined) entry.apiKey = apiKey;
        initializeCalls.push(entry);
      }
      load() {}
      setApiKey() {}
      async resetState() {}
      async fundAccount() {}
      async fundMultipleAccounts() {}
    },
  };
});

vi.mock("../../fork/server.js", () => {
  return {
    ForkServer: class {
      constructor(_p: string, _port: number) {}
      async start() {}
      async stop() {}
    },
  };
});

vi.mock("../../runtime.js", () => ({
  initRuntime: vi.fn(async () => ({})),
}));

vi.mock("../../core/AccountManager.js", () => {
  let _seq = 0;
  return {
    AccountManager: {
      createBatch(labels: readonly string[]) {
        const out: Record<string, { accountAddress: { toString(): string } }> = {};
        for (const l of labels) {
          _seq++;
          const addr = "0x" + _seq.toString(16).padStart(64, "0");
          out[l] = { accountAddress: { toString: () => addr } };
        }
        return out;
      },
      exportPrivateKeys(_labels: readonly string[]) {
        return { deployer: "0x" + "1".repeat(64) };
      },
    },
  };
});

// Imported after mocks so vi.hoisted ordering applies.
import { setupLocalTesting } from "../setupLocalTesting.js";
import { logger } from "../../ui/index.js";

describe("F1 — setupLocalTesting honors forkNetwork", () => {
  let cwdBackup: string;
  let tmpRoot: string;

  beforeEach(() => {
    initializeCalls.length = 0;
    cwdBackup = process.cwd();
    tmpRoot = mkdtempSync(join(tmpdir(), "movehat-f1-"));
    process.chdir(tmpRoot);
    vi.spyOn(logger, "step").mockImplementation(() => undefined);
    vi.spyOn(logger, "success").mockImplementation(() => undefined);
    vi.spyOn(logger, "plain").mockImplementation(() => undefined);
    vi.spyOn(logger, "newline").mockImplementation(() => undefined);
    vi.spyOn(logger, "warning").mockImplementation(() => undefined);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwdBackup);
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses the mainnet RPC when forkNetwork = 'mainnet'", async () => {
    await setupLocalTesting({
      mode: "fork",
      forkNetwork: "mainnet",
      accountLabels: ["deployer"],
      autoFund: false,
    });

    expect(initializeCalls).toHaveLength(1);
    const call = initializeCalls[0]!;
    expect(call.networkName).toBe("mainnet");
    expect(call.nodeUrl).not.toMatch(/testnet/i);
    expect(call.nodeUrl).toMatch(/mainnet/i);
  });

  it("uses the testnet RPC when forkNetwork = 'testnet'", async () => {
    await setupLocalTesting({
      mode: "fork",
      forkNetwork: "testnet",
      accountLabels: ["deployer"],
      autoFund: false,
    });

    expect(initializeCalls).toHaveLength(1);
    const call = initializeCalls[0]!;
    expect(call.networkName).toBe("testnet");
    expect(call.nodeUrl).toMatch(/testnet/i);
  });

  it("uses forkRpcUrl override when supplied for a custom network", async () => {
    await setupLocalTesting({
      mode: "fork",
      forkNetwork: "custom",
      forkRpcUrl: "https://my-custom-node.example/v1",
      accountLabels: ["deployer"],
      autoFund: false,
    });

    expect(initializeCalls).toHaveLength(1);
    const call = initializeCalls[0]!;
    expect(call.networkName).toBe("custom");
    expect(call.nodeUrl).toBe("https://my-custom-node.example/v1");
  });

  it("rejects a non-built-in forkNetwork when no forkRpcUrl is provided", async () => {
    await expect(
      setupLocalTesting({
        mode: "fork",
        forkNetwork: "some-unknown-network",
        accountLabels: ["deployer"],
        autoFund: false,
      })
    ).rejects.toThrow(/forkRpcUrl/i);
    expect(initializeCalls).toHaveLength(0);
  });
});
