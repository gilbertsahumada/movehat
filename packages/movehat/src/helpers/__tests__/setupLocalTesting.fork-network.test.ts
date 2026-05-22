import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * F1 — Harness.createFork(network) must honor the requested network.
 *
 * Mocks ForkManager so we can capture which RPC URL the fresh-fork
 * code path picks. Strategy mirrors the pattern in
 * src/fork/__tests__/manager.test.ts: replace the manager module with
 * a stub that records every call to `initialize`.
 *
 * The mock also implements `load()` + `getMetadata()` so the
 * "fork-exists, wrong network" case (audit-f1 follow-up) can exercise
 * the metadata-mismatch guard in the `else` branch of `setupWithFork`.
 */

interface InitCall {
  nodeUrl: string;
  networkName?: string;
  apiKey?: string;
}
const initializeCalls: InitCall[] = [];

vi.mock("../../fork/manager.js", async () => {
  const fs = await import("node:fs");
  return {
    ForkManager: class {
      forkPath: string;
      metadata: { network: string; nodeUrl: string } | null = null;
      constructor(forkPath: string) {
        this.forkPath = forkPath;
      }
      async initialize(nodeUrl: string, networkName?: string, apiKey?: string) {
        const entry: InitCall = { nodeUrl };
        if (networkName !== undefined) entry.networkName = networkName;
        if (apiKey !== undefined) entry.apiKey = apiKey;
        initializeCalls.push(entry);
        this.metadata = { network: networkName ?? "custom", nodeUrl };
      }
      load() {
        const raw = fs.readFileSync(`${this.forkPath}/metadata.json`, "utf-8");
        this.metadata = JSON.parse(raw);
      }
      getMetadata() {
        if (!this.metadata) {
          throw new Error("Fork not initialized");
        }
        return this.metadata;
      }
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
  // Mock the AccountManager AS A CLASS so `new AccountManager()` works
  // (M9.2 introduced the instance API; setupLocalTesting now constructs
  // a per-context instance and calls createBatch / exportPrivateKeys
  // on it). The mocked instance only needs to satisfy the two methods
  // setupLocalTesting actually invokes here.
  class AccountManager {
    createBatch(labels: readonly string[]) {
      const out: Record<string, { accountAddress: { toString(): string } }> = {};
      for (const l of labels) {
        _seq++;
        const addr = "0x" + _seq.toString(16).padStart(64, "0");
        out[l] = { accountAddress: { toString: () => addr } };
      }
      return out;
    }
    exportPrivateKeys(_labels: readonly string[]) {
      return { deployer: "0x" + "1".repeat(64) };
    }
  }
  return { AccountManager };
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

  it("rejects when an existing fork's saved network does not match the requested one (audit-f1 follow-up)", async () => {
    // Pre-seed `.movehat/forks/test-local/metadata.json` with the
    // wrong network so the `forkExists` branch fires and loads stale
    // metadata. Without the metadata-mismatch guard, setupLocalTesting
    // would silently serve a testnet snapshot while the caller thinks
    // it's reading mainnet.
    const forkDir = join(tmpRoot, ".movehat", "forks", "test-local");
    mkdirSync(forkDir, { recursive: true });
    writeFileSync(
      join(forkDir, "metadata.json"),
      JSON.stringify({
        network: "testnet",
        nodeUrl: "https://testnet.movementnetwork.xyz/v1",
        chainId: 250,
        ledgerVersion: "0",
        timestamp: "0",
        epoch: "0",
        blockHeight: "0",
        createdAt: new Date().toISOString(),
      }),
    );

    await expect(
      setupLocalTesting({
        mode: "fork",
        forkNetwork: "mainnet",
        accountLabels: ["deployer"],
        autoFund: false,
      })
    ).rejects.toThrow(/network mismatch|created for|requested/i);
    // Must not have re-initialized — the existing dir is what poisons
    // the load path, and silently reinitializing would clobber the
    // user's saved snapshot.
    expect(initializeCalls).toHaveLength(0);
  });
});
