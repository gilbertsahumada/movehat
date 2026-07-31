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
  ForkStorage,
  __setForkStorageTestHooks,
  beginCacheGenerationTransition,
  commitCacheGenerationTransition,
} from "../storage.js";
import {
  ForkIdentityMismatchError,
  ForkSnapshotChangedError,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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

  it("preflights before overwriting, and re-adopts the same identity offline", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL, "original");

    // overwrite fetches upstream; a failed fetch leaves the old snapshot intact.
    fakeApi.getLedgerInfo.mockRejectedValueOnce(new Error("replacement RPC unavailable"));
    await expect(
      mgr.initialize("https://replacement.example/v1", "replacement", undefined, { overwrite: true })
    ).rejects.toThrow("replacement RPC unavailable");
    expect(mgr.getMetadata().network).toBe("original");
    expect(mgr.getMetadata().ledgerVersion).toBe("100");

    // An equivalent URL re-adopts the pinned snapshot without an upstream
    // call or rewriting the stored identity.
    fakeApi.getLedgerInfo.mockReset();
    fakeApi.getLedgerInfo.mockRejectedValue(new Error("must not fetch on re-adopt"));
    await mgr.initialize(
      "HTTPS://TESTNET.MOVEMENTNETWORK.XYZ:443/v1/",
      "original",
      "replacement-key"
    );
    expect(mgr.getMetadata().network).toBe("original");
    expect(mgr.getMetadata().nodeUrl).toBe(TEST_NODE_URL);
    expect(mgr.getMetadata().ledgerVersion).toBe("100");
    expect(apiCtorCalls.at(-1)?.apiKey).toBe("replacement-key");
    expect(fakeApi.getLedgerInfo).not.toHaveBeenCalled();
  });

  it("omitting the network label re-adopts the stored identity offline", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL, "original");

    fakeApi.getLedgerInfo.mockReset();
    fakeApi.getLedgerInfo.mockRejectedValue(new Error("must not fetch on re-adopt"));
    await mgr.initialize(TEST_NODE_URL);
    expect(mgr.getMetadata().network).toBe("original");
    expect(mgr.getMetadata().ledgerVersion).toBe("100");
    expect(fakeApi.getLedgerInfo).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "endpoint",
      nodeUrl: "https://replacement.example/v1?token=private",
      network: "original",
      networkChanged: false,
      endpointChanged: true,
    },
    {
      name: "network",
      nodeUrl: TEST_NODE_URL,
      network: "replacement",
      networkChanged: true,
      endpointChanged: false,
    },
    {
      name: "network and endpoint",
      nodeUrl: "https://replacement.example/v1?token=private",
      network: "replacement",
      networkChanged: true,
      endpointChanged: true,
    },
  ])("rejects a changed $name offline without modifying cached state", async ({
    nodeUrl,
    network,
    networkChanged,
    endpointChanged,
  }) => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    fakeApi.getAccountResource.mockResolvedValue({ data: { value: "7" } });
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL, "original", "original-key");
    await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    const storage = new ForkStorage(forkPath);
    const metadataBefore = storage.loadMetadata();
    const generationBefore = storage.getCacheGeneration();

    fakeApi.getLedgerInfo.mockClear();
    fakeApi.getAccountResource.mockClear();
    const error = await mgr
      .initialize(nodeUrl, network, "replacement-key")
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ForkIdentityMismatchError);
    expect(error).toMatchObject({
      storedNetwork: "original",
      requestedNetwork: network,
      networkChanged,
      endpointChanged,
    });
    expect((error as Error).message).not.toContain("token=private");
    expect(fakeApi.getLedgerInfo).not.toHaveBeenCalled();
    expect(mgr.getMetadata()).toEqual(metadataBefore);
    expect(storage.loadMetadata()).toEqual(metadataBefore);
    expect(storage.getCacheGeneration()).toBe(generationBefore);
    expect(storage.getResource(TEST_ADDR, "0x1::counter::Counter")).toEqual({
      value: "7",
    });
    expect(apiCtorCalls.at(-2)?.apiKey).toBe("original-key");

    const cached = await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    expect(cached).toEqual({ value: "7" });
    expect(fakeApi.getAccountResource).not.toHaveBeenCalled();
  });

  it("explicit overwrite adopts a different identity and clears the old cache", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    fakeApi.getAccountResource.mockResolvedValue({ data: { value: "old" } });
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL, "original");
    await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");

    fakeApi.getLedgerInfo.mockResolvedValue({
      ...ledgerInfoFixture(),
      chain_id: 42,
      ledger_version: "200",
    });
    await mgr.initialize(
      "https://replacement.example/v1",
      "replacement",
      undefined,
      { overwrite: true }
    );

    expect(mgr.getMetadata()).toMatchObject({
      network: "replacement",
      nodeUrl: "https://replacement.example/v1",
      chainId: 42,
      ledgerVersion: "200",
    });
    fakeApi.getAccountResource.mockClear();
    fakeApi.getAccountResource.mockResolvedValue({ data: { value: "new" } });
    const resource = await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    expect(resource).toEqual({ value: "new" });
    expect(fakeApi.getAccountResource).toHaveBeenCalledTimes(1);
  });

  it("adopts a 0.6 fork through initialize(): migrates its cache and serves it offline", async () => {
    // Bootstrap a 0.6-style fork: cache a resource, then delete the migration
    // marker so the on-disk state is {resources present, no cache markers} —
    // exactly what a fork written by 0.6.x looks like before adoption.
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    fakeApi.getAccountResource.mockResolvedValue({ data: { value: "42" } });
    const boot = new ForkManager(forkPath);
    await boot.initialize(TEST_NODE_URL);
    await boot.getResource(TEST_ADDR, "0x1::counter::Counter");
    rmSync(join(forkPath, "cache", ".resource-cache-v1"), { force: true });

    // Adopt it with the upstream unreachable — an existing fork must not fetch.
    fakeApi.getLedgerInfo.mockReset();
    fakeApi.getLedgerInfo.mockRejectedValue(new Error("upstream down"));
    fakeApi.getAccountResources.mockClear();
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL);

    const storage = (mgr as unknown as {
      storage: { hasAllResources(address: string): boolean };
    }).storage;
    expect(storage.hasAllResources(TEST_ADDR)).toBe(true);

    const all = await mgr.getAllResources(TEST_ADDR);
    expect(all["0x1::counter::Counter"]).toEqual({ value: "42" });
    expect(fakeApi.getAccountResources).not.toHaveBeenCalled();
    expect(fakeApi.getLedgerInfo).not.toHaveBeenCalled();
  });

  it("keeps the pinned ledger version when re-initializing over a cached snapshot", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    fakeApi.getAccountResource.mockResolvedValue({ data: { value: "7" } });
    const mgr = new ForkManager(forkPath);
    await mgr.initialize(TEST_NODE_URL);
    await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");

    // Upstream has advanced to 101, but a non-overwrite re-init must not move
    // the pin out from under the resource cached at 100.
    fakeApi.getLedgerInfo.mockResolvedValue({ ...ledgerInfoFixture(), ledger_version: "101" });
    const callsBefore = fakeApi.getLedgerInfo.mock.calls.length;
    await mgr.initialize(TEST_NODE_URL);

    expect(mgr.getMetadata().ledgerVersion).toBe("100");
    expect(fakeApi.getLedgerInfo.mock.calls.length).toBe(callsBefore);

    fakeApi.getAccountResource.mockClear();
    const cached = await mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    expect(cached).toEqual({ value: "7" });
    expect(fakeApi.getAccountResource).not.toHaveBeenCalled();
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

  it("load fails closed while a snapshot rotation is incomplete", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const first = new ForkManager(forkPath);
    await first.initialize(TEST_NODE_URL);
    beginCacheGenerationTransition(forkPath);

    const reloaded = new ForkManager(forkPath);
    let loadError: unknown;
    try {
      reloaded.load();
    } catch (error) {
      loadError = error;
    }
    expect(loadError).toBeInstanceOf(ForkSnapshotChangedError);
    expect((loadError as Error).message).toMatch(
      /movehat fork create.*initialize\(\).*overwrite: true/i
    );
  });

  it("does not let a stale legacy migration mark a replacement cache as complete", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const first = new ForkManager(forkPath);
    await first.initialize(TEST_NODE_URL);

    const storage = new ForkStorage(forkPath);
    const legacyType = "0x1::legacy::Complete";
    const partialType = "0x1::new::Partial";
    const fetchedType = "0x1::new::Fetched";
    storage.saveResource(TEST_ADDR, legacyType, { value: "legacy" });
    rmSync(join(forkPath, "cache", ".resource-cache-v1"), { force: true });

    let replacementGeneration: string | undefined;
    __setForkStorageTestHooks({
      beforeLegacyMarkerWrite: (address) => {
        if (address === TEST_ADDR && replacementGeneration === undefined) {
          replacementGeneration = beginCacheGenerationTransition(forkPath);
          storage.clearResources();
          storage.saveResource(TEST_ADDR, partialType, { value: "partial" });
          commitCacheGenerationTransition(forkPath, replacementGeneration);
        }
      },
    });

    const stale = new ForkManager(forkPath);
    try {
      expect(() => stale.load()).toThrow(ForkSnapshotChangedError);
    } finally {
      __setForkStorageTestHooks();
    }

    expect(replacementGeneration).toBeDefined();
    expect(storage.getCacheGeneration()).toBe(replacementGeneration);

    fakeApi.getAccountResources.mockResolvedValue([
      { type: fetchedType, data: { value: "fetched" } },
    ]);
    const current = new ForkManager(forkPath);
    current.load();

    const resources = await current.getAllResources(TEST_ADDR);
    expect(fakeApi.getAccountResources).toHaveBeenCalledOnce();
    expect(resources).toEqual({
      [partialType]: { value: "partial" },
      [fetchedType]: { value: "fetched" },
    });
  });

  it("an explicit overwrite recovers an interrupted snapshot rotation", async () => {
    fakeApi.getLedgerInfo.mockResolvedValue(ledgerInfoFixture());
    const first = new ForkManager(forkPath);
    await first.initialize(TEST_NODE_URL);
    beginCacheGenerationTransition(forkPath);

    fakeApi.getLedgerInfo.mockResolvedValue({
      ...ledgerInfoFixture(),
      ledger_version: "200",
    });
    const recovering = new ForkManager(forkPath);
    await recovering.initialize(TEST_NODE_URL, "replacement", undefined, {
      overwrite: true,
    });

    expect(recovering.getMetadata().ledgerVersion).toBe("200");
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

  it("rejects an account fetch from before resetState", async () => {
    const pending = deferred<{ sequence_number: string; authentication_key: string }>();
    fakeApi.getAccount.mockReturnValueOnce(pending.promise);

    const read = mgr.getAccount(TEST_ADDR);
    await vi.waitFor(() => expect(fakeApi.getAccount).toHaveBeenCalledTimes(1));
    await mgr.resetState();
    pending.resolve({ sequence_number: "7", authentication_key: "0xold" });

    await expect(read).rejects.toBeInstanceOf(ForkSnapshotChangedError);
    expect(mgr.listAccounts()).toEqual([]);
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

  it("rejects a resource fetch from before overwrite", async () => {
    const pending = deferred<{ data: { value: string } }>();
    fakeApi.getAccountResource.mockReturnValueOnce(pending.promise);

    const read = mgr.getResource(TEST_ADDR, "0x1::counter::Counter");
    await vi.waitFor(() => expect(fakeApi.getAccountResource).toHaveBeenCalledTimes(1));
    await mgr.initialize(TEST_NODE_URL, "replacement", undefined, { overwrite: true });
    pending.resolve({ data: { value: "old" } });

    await expect(read).rejects.toBeInstanceOf(ForkSnapshotChangedError);
    const storage = (mgr as unknown as {
      storage: { hasResource(address: string, type: string): boolean };
    }).storage;
    expect(storage.hasResource(TEST_ADDR, "0x1::counter::Counter")).toBe(false);
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

  it("translates a cache file disappearing during rotation into a snapshot error", async () => {
    fakeApi.getAccountResources.mockResolvedValue([
      { type: "0x1::a::A", data: { x: 1 } },
    ]);
    await mgr.getAllResources(TEST_ADDR);

    const storage = new ForkStorage(forkPath);
    let transitionStarted = false;
    __setForkStorageTestHooks({
      beforeAllResourcesMarkerRead: (address) => {
        if (address === TEST_ADDR && !transitionStarted) {
          transitionStarted = true;
          beginCacheGenerationTransition(forkPath);
          storage.clearResources();
        }
      },
    });

    try {
      await expect(mgr.getAllResources(TEST_ADDR)).rejects.toBeInstanceOf(
        ForkSnapshotChangedError
      );
    } finally {
      __setForkStorageTestHooks();
    }
    expect(transitionStarted).toBe(true);
  });

  it("preserves a storage read error when the cache generation is stable", async () => {
    fakeApi.getAccountResources.mockResolvedValue([
      { type: "0x1::a::A", data: { x: 1 } },
    ]);
    await mgr.getAllResources(TEST_ADDR);

    let markerRemoved = false;
    __setForkStorageTestHooks({
      beforeAllResourcesMarkerRead: (address) => {
        if (address === TEST_ADDR && !markerRemoved) {
          markerRemoved = true;
          rmSync(join(forkPath, "cache", `${TEST_ADDR}.all-resources`));
        }
      },
    });

    try {
      await expect(mgr.getAllResources(TEST_ADDR)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      __setForkStorageTestHooks();
    }
    expect(markerRemoved).toBe(true);
  });

  it("rejects an all-resources fetch from before resetState", async () => {
    const pending = deferred<Array<{ type: string; data: { value: string } }>>();
    fakeApi.getAccountResources.mockReturnValueOnce(pending.promise);

    const read = mgr.getAllResources(TEST_ADDR);
    await vi.waitFor(() => expect(fakeApi.getAccountResources).toHaveBeenCalledTimes(1));
    await mgr.resetState();
    pending.resolve([{ type: "0x1::a::A", data: { value: "old" } }]);

    await expect(read).rejects.toBeInstanceOf(ForkSnapshotChangedError);
    const storage = (mgr as unknown as {
      storage: { hasAllResources(address: string): boolean };
    }).storage;
    expect(storage.hasAllResources(TEST_ADDR)).toBe(false);
  });

  it("refetches when an all-resources marker outlived its data file", async () => {
    // An unlocked legacy migration racing a cache sweep can leave the marker
    // behind without its data file. Serving that as a complete snapshot would
    // answer {} forever; the address must be refetched instead.
    fakeApi.getAccountResources.mockResolvedValue([
      { type: "0x1::counter::Counter", data: { value: "7" } },
    ]);
    await mgr.getAllResources(TEST_ADDR);
    rmSync(join(forkPath, "resources", `${TEST_ADDR}.json`), { force: true });
    fakeApi.getAccountResources.mockClear();

    const all = await mgr.getAllResources(TEST_ADDR);

    expect(fakeApi.getAccountResources).toHaveBeenCalledTimes(1);
    expect(all["0x1::counter::Counter"]).toEqual({ value: "7" });
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

  it("fundAccount rejects a balance fetched before a concurrent overwrite", async () => {
    // The upstream balance resolves only after an overwrite rotates the
    // snapshot generation; the stale balance must not land in the new snapshot.
    const pending = deferred<{ data: unknown }>();
    fakeApi.getAccountResource.mockReturnValueOnce(pending.promise);

    const funding = mgr.fundAccount(TEST_ADDR, 1_000);
    await vi.waitFor(() => expect(fakeApi.getAccountResource).toHaveBeenCalledTimes(1));

    // Concurrent overwrite advances the generation and clears cached state.
    await mgr.initialize(TEST_NODE_URL, "custom", undefined, { overwrite: true });

    pending.resolve({
      data: {
        coin: { value: "5000" },
        deposit_events: { counter: "0", guid: { id: { addr: TEST_ADDR, creation_num: "0" } } },
        withdraw_events: { counter: "0", guid: { id: { addr: TEST_ADDR, creation_num: "1" } } },
        frozen: false,
      },
    });
    await expect(funding).rejects.toBeInstanceOf(ForkSnapshotChangedError);

    const storage = (mgr as unknown as {
      storage: { hasResource(address: string, type: string): boolean };
    }).storage;
    expect(storage.hasResource(TEST_ADDR, COIN_TYPE)).toBe(false);
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

describe("ForkManager — stale instance contract", () => {
  let tmpDir: string;
  let forkPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-forkmgr-stale-"));
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

  async function managersAcrossOverwrite(): Promise<{
    stale: ForkManager;
    current: ForkManager;
  }> {
    fakeApi.getLedgerInfo.mockResolvedValueOnce(ledgerInfoFixture());
    const stale = new ForkManager(forkPath);
    await stale.initialize(TEST_NODE_URL, "testnet");

    fakeApi.getAccount.mockResolvedValueOnce({
      sequence_number: "1",
      authentication_key: "0xold",
    });
    fakeApi.getAccountResource.mockResolvedValueOnce({
      data: { fromLedger: "100" },
    });
    fakeApi.getAccountResources.mockResolvedValueOnce([
      { type: "0x1::old::Resource", data: { fromLedger: "100" } },
    ]);
    await stale.getAccount(TEST_ADDR);
    await stale.getResource(TEST_ADDR, "0x1::old::Resource");
    await stale.getAllResources(TEST_ADDR);

    fakeApi.getLedgerInfo.mockResolvedValueOnce({
      ...ledgerInfoFixture(),
      ledger_version: "200",
      block_height: "84",
    });
    const current = new ForkManager(forkPath);
    await current.initialize(TEST_NODE_URL, "testnet", undefined, {
      overwrite: true,
    });

    fakeApi.getAccount.mockResolvedValueOnce({
      sequence_number: "2",
      authentication_key: "0xnew",
    });
    fakeApi.getAccountResources.mockResolvedValueOnce([
      { type: "0x1::new::Resource", data: { fromLedger: "200" } },
    ]);
    await current.getAccount(TEST_ADDR);
    await current.getAllResources(TEST_ADDR);
    return { stale, current };
  }

  it("rejects cached reads and synchronous inspection after another manager overwrites", async () => {
    const { stale, current } = await managersAcrossOverwrite();

    await expect(stale.getAccount(TEST_ADDR)).rejects.toBeInstanceOf(
      ForkSnapshotChangedError
    );
    await expect(
      stale.getResource(TEST_ADDR, "0x1::new::Resource")
    ).rejects.toBeInstanceOf(ForkSnapshotChangedError);
    await expect(stale.getAllResources(TEST_ADDR)).rejects.toBeInstanceOf(
      ForkSnapshotChangedError
    );
    expect(() => stale.getMetadata()).toThrow(ForkSnapshotChangedError);
    expect(() => stale.listAccounts()).toThrow(ForkSnapshotChangedError);

    expect(current.getMetadata().ledgerVersion).toBe("200");
    await expect(
      current.getResource(TEST_ADDR, "0x1::new::Resource")
    ).resolves.toEqual({ fromLedger: "200" });

    stale.load();
    expect(stale.getMetadata().ledgerVersion).toBe("200");
    await expect(stale.getAccount(TEST_ADDR)).resolves.toMatchObject({
      sequenceNumber: "2",
      authenticationKey: "0xnew",
    });
    await expect(
      stale.getResource(TEST_ADDR, "0x1::new::Resource")
    ).resolves.toEqual({ fromLedger: "200" });
  });

  it("rejects every stale mutation without changing the replacement snapshot", async () => {
    const { stale, current } = await managersAcrossOverwrite();
    const replacement = { fromLedger: "200" };

    await expect(
      stale.setResource(TEST_ADDR, "0x1::new::Resource", { corrupted: true })
    ).rejects.toBeInstanceOf(ForkSnapshotChangedError);
    await expect(stale.fundAccount(TEST_ADDR, 10)).rejects.toBeInstanceOf(
      ForkSnapshotChangedError
    );
    await expect(stale.getOrCreateAccount(TEST_ADDR)).rejects.toBeInstanceOf(
      ForkSnapshotChangedError
    );
    await expect(stale.resetState()).rejects.toBeInstanceOf(
      ForkSnapshotChangedError
    );

    expect(current.getMetadata().ledgerVersion).toBe("200");
    await expect(
      current.getResource(TEST_ADDR, "0x1::new::Resource")
    ).resolves.toEqual(replacement);
  });

  it("rejects a view response if overwrite commits while it is in flight", async () => {
    fakeApi.getLedgerInfo.mockResolvedValueOnce(ledgerInfoFixture());
    const stale = new ForkManager(forkPath);
    await stale.initialize(TEST_NODE_URL, "testnet");

    const pending = deferred<unknown[]>();
    fakeApi.view.mockReturnValueOnce(pending.promise);
    const view = stale.forwardView({ function: "0x1::m::f" });
    await vi.waitFor(() => expect(fakeApi.view).toHaveBeenCalledTimes(1));

    fakeApi.getLedgerInfo.mockResolvedValueOnce({
      ...ledgerInfoFixture(),
      ledger_version: "200",
    });
    const current = new ForkManager(forkPath);
    await current.initialize(TEST_NODE_URL, "testnet", undefined, {
      overwrite: true,
    });
    pending.resolve(["old"]);

    await expect(view).rejects.toBeInstanceOf(ForkSnapshotChangedError);
  });
});
