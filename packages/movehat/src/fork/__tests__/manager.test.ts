import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests for `ForkManager`. Strategy:
 *   - `vi.mock` the upstream `MovementApiClient` (network layer) so
 *     tests stay offline and deterministic.
 *   - Use a REAL `ForkStorage` against a tmpdir (storage is already
 *     covered at ~85% by its own suite; we treat it as a trusted
 *     dependency here and assert the manager's lifecycle on top of it).
 */

// Module-scoped fakes — populated per test via setMockApi() below.
const fakeApi = {
  getLedgerInfo: vi.fn(),
  getAccount: vi.fn(),
  getAccountResource: vi.fn(),
  getAccountResources: vi.fn(),
  view: vi.fn(),
};

// Track the (nodeUrl, apiKey) pair every constructor call sees, so we
// can assert setApiKey reconstructs the client.
const apiCtorCalls: Array<{ nodeUrl: string; apiKey?: string | undefined }> = [];

vi.mock("../api.js", () => ({
  MovementApiClient: class {
    constructor(nodeUrl: string, apiKey?: string) {
      apiCtorCalls.push({ nodeUrl, apiKey });
    }
    getLedgerInfo = fakeApi.getLedgerInfo;
    getAccount = fakeApi.getAccount;
    getAccountResource = fakeApi.getAccountResource;
    getAccountResources = fakeApi.getAccountResources;
    view = fakeApi.view;
  },
}));

// Static import after the mock declaration — vi hoists vi.mock calls.
import { ForkManager } from "../manager.js";
import {
  ForkAlreadyExistsError,
  ForkSnapshotPrunedError,
  MovementApiError,
} from "../errors.js";

const TEST_NODE_URL = "https://testnet.movementnetwork.xyz/v1";
const TEST_ADDR = "0x" + "a".repeat(64);
const COIN_TYPE = "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>";

function ledgerInfoFixture() {
  return {
    chain_id: 27,
    ledger_version: "100",
    ledger_timestamp: "1234567890",
    epoch: "5",
    block_height: "42",
  };
}

describe("ForkManager — initialize / load", () => {
  let tmpDir: string;
  let forkPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-forkmgr-"));
    forkPath = join(tmpDir, "fork");
    apiCtorCalls.length = 0;
    fakeApi.getLedgerInfo.mockReset();
    fakeApi.getAccount.mockReset();
    fakeApi.getAccountResource.mockReset();
    fakeApi.getAccountResources.mockReset();
    fakeApi.view.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initialize writes metadata and constructs an API client without apiKey by default", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);

    await mgr.initialize(TEST_NODE_URL);

    expect(apiCtorCalls).toHaveLength(1);
    expect(apiCtorCalls[0]?.nodeUrl).toBe(TEST_NODE_URL);
    expect(apiCtorCalls[0]?.apiKey).toBeUndefined();

    const meta = mgr.getMetadata();
    expect(meta.network).toBe("custom");
    expect(meta.nodeUrl).toBe(TEST_NODE_URL);
    expect(meta.chainId).toBe(27);
    expect(meta.ledgerVersion).toBe("100");
  });

  it("initialize passes apiKey through to the API client", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);

    await mgr.initialize(TEST_NODE_URL, "testnet", "secret-key");

    expect(apiCtorCalls).toHaveLength(1);
    expect(apiCtorCalls[0]?.apiKey).toBe("secret-key");
  });

  it("reinitializing without an apiKey clears a key from the prior initialization", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);

    await mgr.initialize(TEST_NODE_URL, "testnet", "secret-key");
    await mgr.initialize(TEST_NODE_URL, "testnet", undefined, { overwrite: true });

    expect(apiCtorCalls.at(-1)?.apiKey).toBeUndefined();
  });

  it("initialize labels the fork with the provided networkName", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);

    await mgr.initialize(TEST_NODE_URL, "bardock-testnet");

    expect(mgr.getMetadata().network).toBe("bardock-testnet");
  });

  it("preflights before refusing or overwriting an existing fork", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL, "original");

    fakeApi.getLedgerInfo.mockRejectedValueOnce(new Error("replacement RPC unavailable"));
    await expect(
      mgr.initialize("https://replacement.example/v1", "replacement", undefined, { overwrite: true })
    ).rejects.toThrow("replacement RPC unavailable");
    expect(mgr.getMetadata().network).toBe("original");

    fakeApi.getLedgerInfo.mockResolvedValueOnce(ledgerInfoFixture());
    await expect(mgr.initialize(TEST_NODE_URL)).rejects.toBeInstanceOf(ForkAlreadyExistsError);
  });

  it("load throws when the fork directory doesn't exist", () => {
    const mgr = new ForkManager(forkPath);
    expect(() => mgr.load()).toThrow(/Fork does not exist/);
  });

  it("canonicalizes real and symlink aliases to the same lock namespace", () => {
    mkdirSync(forkPath, { recursive: true });
    const alias = join(tmpDir, "fork-alias");
    symlinkSync(forkPath, alias, "dir");
    const realManager = new ForkManager(forkPath) as unknown as {
      forkPath: string;
      accountLockKey(): string;
      resourceLockKey(): string;
    };
    const aliasManager = new ForkManager(alias) as unknown as typeof realManager;

    expect(aliasManager.forkPath).toBe(realManager.forkPath);
    expect(aliasManager.accountLockKey()).toBe(realManager.accountLockKey());
    expect(aliasManager.resourceLockKey()).toBe(realManager.resourceLockKey());
  });

  it("load restores metadata from disk and reconstructs the API client", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const first = new ForkManager(forkPath);
    await first.initialize(TEST_NODE_URL);

    apiCtorCalls.length = 0;

    const reloaded = new ForkManager(forkPath);
    reloaded.load();

    expect(apiCtorCalls).toHaveLength(1);
    expect(reloaded.getMetadata().nodeUrl).toBe(TEST_NODE_URL);
  });

  it("setApiKey reconstructs the API client when one already exists", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL);

    apiCtorCalls.length = 0;
    mgr.setApiKey("new-key");

    expect(apiCtorCalls).toHaveLength(1);
    expect(apiCtorCalls[0]?.apiKey).toBe("new-key");
  });

  it("setApiKey(undefined) clears the key on the next reconstruction", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL, "custom", "key");

    apiCtorCalls.length = 0;
    mgr.setApiKey(undefined);

    expect(apiCtorCalls).toHaveLength(1);
    expect(apiCtorCalls[0]?.apiKey).toBeUndefined();
  });

  it("setApiKey is a no-op before initialize/load (no client yet)", () => {
    const mgr = new ForkManager(forkPath);
    apiCtorCalls.length = 0;
    mgr.setApiKey("key");
    expect(apiCtorCalls).toHaveLength(0);
  });
});

describe("ForkManager — account + resource fetch", () => {
  let tmpDir: string;
  let forkPath: string;
  let mgr: ForkManager;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-forkmgr-"));
    forkPath = join(tmpDir, "fork");
    apiCtorCalls.length = 0;
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    fakeApi.getAccount.mockReset();
    fakeApi.getAccountResource.mockReset();
    fakeApi.getAccountResources.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getAccount fetches from API and caches in storage on first call", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "7",
      authentication_key: "0xabc",
    });

    const state = await mgr.getAccount(TEST_ADDR);
    expect(state.sequenceNumber).toBe("7");
    expect(state.authenticationKey).toBe("0xabc");
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
    expect(fakeApi.getAccount).toHaveBeenCalledWith(TEST_ADDR, "100");
  });

  it("getAccount returns the cached state on second call (no extra API hit)", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "7",
      authentication_key: "0xabc",
    });

    await mgr.getAccount(TEST_ADDR);
    await mgr.getAccount(TEST_ADDR);

    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
  });

  it("getAccount throws if the manager was never initialized/loaded", async () => {
    const fresh = new ForkManager(join(tmpDir, "uninitialized"));
    await expect(fresh.getAccount(TEST_ADDR)).rejects.toThrow(
      /Fork not initialized/
    );
  });

  it("getResource fetches and caches by resource type", async () => {
    fakeApi.getAccountResource.mockResolvedValue({
      data: { value: "42" },
    });

    const r1 = await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    expect(r1).toEqual({ value: "42" });
    const r2 = await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    expect(r2).toEqual({ value: "42" });
    expect(fakeApi.getAccountResource).toHaveBeenCalledTimes(1);
  });

  it("getResource rethrows a clean 'not found' for upstream 404 errors", async () => {
    fakeApi.getAccountResource.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );
    await expect(
      mgr.getResource(TEST_ADDR, "0x1::missing::Resource")
    ).rejects.toThrow(/Resource .* not found for account/);
  });

  it("getResource rethrows other errors unchanged", async () => {
    fakeApi.getAccountResource.mockRejectedValue(new Error("connection refused"));
    await expect(
      mgr.getResource(TEST_ADDR, "0x1::missing::Resource")
    ).rejects.toThrow(/connection refused/);
  });

  it("distinguishes a pruned pinned snapshot from missing data", async () => {
    fakeApi.getAccountResource.mockRejectedValue(new MovementApiError(
      "gone",
      "http_error",
      { statusCode: 410, upstreamErrorCode: "version_pruned" }
    ));
    const error = await mgr.getResource(TEST_ADDR, "0x1::missing::Resource")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ForkSnapshotPrunedError);
    expect((error as Error).message).toMatch(/recreate.*overwrite/i);
    expect((error as Error).message).toMatch(/resetState.*cannot/i);
  });

  it("translates a pruned pinned view snapshot", async () => {
    fakeApi.view.mockRejectedValue(new MovementApiError(
      "gone",
      "http_error",
      { statusCode: 404, upstreamErrorCode: "version_pruned" }
    ));
    const error = await mgr.forwardView({ function: "0x1::m::f" })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ForkSnapshotPrunedError);
    expect((error as Error).message).toMatch(/recreate.*overwrite/i);
    expect((error as Error).message).toMatch(/resetState.*cannot/i);
  });

  it("getAllResources fetches the whole list once, caches, and returns by type", async () => {
    fakeApi.getAccountResources.mockResolvedValue([
      { type: "0x1::a::A", data: { x: 1 } },
      { type: "0x1::b::B", data: { y: 2 } },
    ]);

    const first = await mgr.getAllResources(TEST_ADDR);
    expect(Object.keys(first).sort()).toEqual(["0x1::a::A", "0x1::b::B"]);
    expect(first["0x1::a::A"]).toEqual({ x: 1 });
    expect(fakeApi.getAccountResources).toHaveBeenCalledWith(TEST_ADDR, "100");

    // Second call should hit cache (API call count stays at 1).
    await mgr.getAllResources(TEST_ADDR);
    expect(fakeApi.getAccountResources).toHaveBeenCalledTimes(1);
  });
});

describe("ForkManager — fundAccount / setResource / list / getOrCreateAccount", () => {
  let tmpDir: string;
  let forkPath: string;
  let mgr: ForkManager;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-forkmgr-"));
    forkPath = join(tmpDir, "fork");
    apiCtorCalls.length = 0;
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    fakeApi.getAccount.mockReset();
    fakeApi.getAccountResource.mockReset();
    fakeApi.getAccountResources.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fundAccount creates a fresh CoinStore when none exists upstream", async () => {
    fakeApi.getAccountResource.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );

    await mgr.fundAccount(TEST_ADDR, 1_000);

    // Now the resource should be in cache — read it back without another API hit.
    fakeApi.getAccountResource.mockClear();
    const stored = await mgr.getResource(TEST_ADDR, COIN_TYPE);
    expect(stored).toBeDefined();
    expect(stored.coin.value).toBe("1000");
    expect(fakeApi.getAccountResource).not.toHaveBeenCalled();
  });

  it("fundAccount adds to existing balance on a second call (accumulates)", async () => {
    fakeApi.getAccountResource.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );
    await mgr.fundAccount(TEST_ADDR, 1_000);
    await mgr.fundAccount(TEST_ADDR, 500);

    const stored = await mgr.getResource(TEST_ADDR, COIN_TYPE);
    expect(stored.coin.value).toBe("1500");
  });

  it("fundAccount rethrows non-404 errors from getResource", async () => {
    fakeApi.getAccountResource.mockRejectedValue(new Error("upstream is angry"));
    await expect(mgr.fundAccount(TEST_ADDR, 100)).rejects.toThrow(/upstream is angry/);
  });

  it("fundMultipleAccounts funds every address in the list", async () => {
    fakeApi.getAccountResource.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );

    const addrs = [
      "0x" + "1".repeat(64),
      "0x" + "2".repeat(64),
      "0x" + "3".repeat(64),
    ];
    await mgr.fundMultipleAccounts(addrs, 500);

    // Each address now has a 500-balance CoinStore in cache.
    fakeApi.getAccountResource.mockClear();
    for (const addr of addrs) {
      const stored = await mgr.getResource(addr, COIN_TYPE);
      expect(stored.coin.value).toBe("500");
    }
    expect(fakeApi.getAccountResource).not.toHaveBeenCalled();
  });

  it("setResource overwrites a cached resource", async () => {
    await mgr.setResource(TEST_ADDR, "0x1::custom::Resource", { value: 1 });
    await mgr.setResource(TEST_ADDR, "0x1::custom::Resource", { value: 2 });
    const stored = await mgr.getResource(TEST_ADDR, "0x1::custom::Resource");
    expect(stored).toEqual({ value: 2 });
  });

  it("listAccounts returns the cached account list", async () => {
    fakeApi.getAccountResource.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );
    await mgr.fundAccount(TEST_ADDR, 100);
    const list = mgr.listAccounts();
    expect(list.length).toBeGreaterThan(0);
  });

  it("getOrCreateAccount returns the existing account when one is cached", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "0",
      authentication_key: "0xabc",
    });
    await mgr.getAccount(TEST_ADDR);
    fakeApi.getAccount.mockClear();

    const result = await mgr.getOrCreateAccount(TEST_ADDR);
    expect(result.authenticationKey).toBe("0xabc");
    expect(fakeApi.getAccount).not.toHaveBeenCalled();
  });

  it("getOrCreateAccount synthesizes a minimal account when the upstream lookup fails", async () => {
    // Force the storage cache miss AND the API throw, exercising the
    // catch arm that creates the account locally.
    fakeApi.getAccount.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );

    const result = await mgr.getOrCreateAccount(TEST_ADDR);
    expect(result.sequenceNumber).toBe("0");
    expect(result.authenticationKey).toHaveLength(66);
  });

  it("returns the account persisted by a concurrent creator", async () => {
    fakeApi.getAccount.mockRejectedValue(
      new MovementApiError("not found", "http_error", { statusCode: 404 })
    );
    const winner = { sequenceNumber: "9", authenticationKey: "0xwinner" };
    const storage = (mgr as unknown as { storage: { getAccount(address: string): unknown } }).storage;
    const originalGetAccount = storage.getAccount.bind(storage);
    let reads = 0;
    vi.spyOn(storage, "getAccount").mockImplementation((address: string) => {
      reads += 1;
      if (reads === 1) return undefined;
      if (reads === 2) return winner;
      return originalGetAccount(address);
    });

    await expect(mgr.getOrCreateAccount(TEST_ADDR)).resolves.toEqual(winner);
  });

  it("resetState clears cached accounts and resources", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "5",
      authentication_key: "0xabc",
    });
    await mgr.getAccount(TEST_ADDR);

    await mgr.resetState();

    fakeApi.getAccount.mockClear();
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "5",
      authentication_key: "0xabc",
    });
    // After reset, fetching again should hit the API (not the cache).
    await mgr.getAccount(TEST_ADDR);
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
  });
});
