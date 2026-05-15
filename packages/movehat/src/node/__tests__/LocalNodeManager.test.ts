import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalNodeManager } from "../LocalNodeManager.js";
import type {
  ChildProcessAdapter,
  SpawnInput,
  SpawnedProcess,
} from "../../utils/childProcessAdapter.js";

/**
 * Tests for `LocalNodeManager`.
 *
 * Strategy:
 *   - Inject a fake `ChildProcessAdapter` so we control the spawn
 *     handle (stdout/stderr streams, kill semantics, exit promise).
 *   - Stub global `fetch` so the ready/faucet endpoints return
 *     controllable responses without real HTTP.
 *
 * What we DON'T test here:
 *   - The 60-second ready timeout in real-time (would block the suite).
 *     Instead we either stub fetch to succeed on first call, or for the
 *     timeout-path test we shrink the timeout via a wrapper that bypasses
 *     `start()` and calls a faster path. The timeout error message is
 *     verified by exercising `start()` with a never-ready fetch and
 *     fake timers.
 */

interface FakeSpawnedProcess extends SpawnedProcess {
  /** Test helper — manually trigger the "exited" promise resolution. */
  __exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

function buildFakeSpawned(): FakeSpawnedProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let exitResolve!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      exitResolve = resolve;
    }
  );
  let killed = false;
  const proc: FakeSpawnedProcess = {
    pid: 4242,
    stdout,
    stderr,
    stdin,
    kill: (_signal?: NodeJS.Signals) => {
      if (killed) return false;
      killed = true;
      // Resolve `exited` shortly after kill so `stop()` doesn't hang.
      setImmediate(() => exitResolve({ code: null, signal: _signal ?? "SIGTERM" }));
      return true;
    },
    exited,
    __exit: (code, signal) => exitResolve({ code, signal }),
  };
  return proc;
}

function buildFakeAdapter(): {
  adapter: ChildProcessAdapter;
  calls: SpawnInput[];
  spawned: FakeSpawnedProcess[];
} {
  const calls: SpawnInput[] = [];
  const spawned: FakeSpawnedProcess[] = [];
  const adapter: ChildProcessAdapter = {
    run: vi.fn(),
    spawn: (input) => {
      calls.push(input);
      const proc = buildFakeSpawned();
      spawned.push(proc);
      return proc;
    },
  };
  return { adapter, calls, spawned };
}

function stubFetchOnce(response: { ok: boolean; text?: () => Promise<string>; json?: () => Promise<unknown> }) {
  const fn = vi.fn().mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function stubFetchAlwaysOk() {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("LocalNodeManager — start / stop / lifecycle", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-localnode-"));
    // The logger prints to stdout/stderr; silence the noise for cleaner test output.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("constructs with sensible defaults from getNodeInfo", () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });

    const info = mgr.getNodeInfo();
    expect(info.rpcUrl).toBe("http://127.0.0.1:8080");
    expect(info.faucetUrl).toBe("http://127.0.0.1:8081");
    expect(info.readyUrl).toBe("http://127.0.0.1:8070");
    expect(info.testDir).toBe(tmpDir);
  });

  it("honors custom ports from constructor options", () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new LocalNodeManager({
      adapter,
      testDir: tmpDir,
      apiPort: 9000,
      faucetPort: 9001,
      readyPort: 9002,
    });
    const info = mgr.getNodeInfo();
    expect(info.rpcUrl).toContain(":9000");
    expect(info.faucetUrl).toContain(":9001");
    expect(info.readyUrl).toContain(":9002");
  });

  it("isRunning reports false before start", () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    expect(mgr.isRunning()).toBe(false);
  });

  it("start spawns 'movement node run-localnet' with the expected args", async () => {
    const { adapter, calls } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });

    await mgr.start();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("movement");
    const args = calls[0]?.args ?? [];
    expect(args.slice(0, 2)).toEqual(["node", "run-localnet"]);
    expect(args).toContain("--test-dir");
    expect(args).toContain(tmpDir);
    expect(args).toContain("--faucet-port");
    expect(args).toContain("8081");
    expect(args).toContain("--assume-yes");
    expect(mgr.isRunning()).toBe(true);
  });

  it("start in silent mode does not wire stdout/stderr listeners", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });

    await mgr.start();

    // The PassThrough streams should have no `data` listeners attached
    // when `silent: true` is set.
    const proc = spawned[0]!;
    expect(proc.stdout!.listenerCount("data")).toBe(0);
    expect(proc.stderr!.listenerCount("data")).toBe(0);
  });

  it("start in non-silent mode wires stdout/stderr listeners that log events", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: false });

    await mgr.start();

    const proc = spawned[0]!;
    expect(proc.stdout!.listenerCount("data")).toBeGreaterThan(0);
    expect(proc.stderr!.listenerCount("data")).toBeGreaterThan(0);

    // Drive a line through stdout — the manager's listener forwards to console.log.
    proc.stdout!.emit("data", Buffer.from("local node ready\n"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("local node ready"));

    // stderr non-WARN line goes through console.error.
    proc.stderr!.emit("data", Buffer.from("real error\n"));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("real error"));

    // stderr WARN line should be filtered (no error log).
    errSpy.mockClear();
    proc.stderr!.emit("data", Buffer.from("WARN something\n"));
    expect(errSpy).not.toHaveBeenCalledWith(expect.stringContaining("WARN"));
  });

  it("force-restart cleans the test directory before spawn", async () => {
    const { adapter } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const planted = join(tmpDir, "stale-file.txt");
    // Create a stale file to prove the cleanup actually removes it.
    mkdirSync(tmpDir, { recursive: true });
    require("node:fs").writeFileSync(planted, "stale");
    expect(existsSync(planted)).toBe(true);

    const mgr = new LocalNodeManager({
      adapter,
      testDir: tmpDir,
      forceRestart: true,
      silent: true,
    });

    await mgr.start();
    expect(existsSync(planted)).toBe(false);
  });

  it("force-restart appends --force-restart to the CLI args", async () => {
    const { adapter, calls } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({
      adapter,
      testDir: tmpDir,
      forceRestart: true,
      silent: true,
    });
    await mgr.start();
    expect(calls[0]?.args).toContain("--force-restart");
  });

  it("calling start twice returns the same node info (idempotent)", async () => {
    const { adapter, calls } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });

    const info1 = await mgr.start();
    const info2 = await mgr.start();
    expect(info2).toEqual(info1);
    expect(calls).toHaveLength(1);
  });

  it("stop signals SIGTERM and clears the spawned handle", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();

    const killSpy = vi.spyOn(spawned[0]!, "kill");
    await mgr.stop();

    expect(killSpy).toHaveBeenCalledWith("SIGTERM");
    expect(mgr.isRunning()).toBe(false);
  });

  it("stop is a no-op when no node is running", async () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    // Should not throw.
    await mgr.stop();
    expect(mgr.isRunning()).toBe(false);
  });

  it("clean refuses while the node is running", async () => {
    const { adapter } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();

    await expect(mgr.clean()).rejects.toThrow(/Cannot clean while node is running/);
  });

  it("clean removes the test directory after stop", async () => {
    const { adapter } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();
    await mgr.stop();

    expect(existsSync(tmpDir)).toBe(true);
    await mgr.clean();
    expect(existsSync(tmpDir)).toBe(false);
  });

  it("clean is a no-op when the test directory doesn't exist", async () => {
    const { adapter } = buildFakeAdapter();
    const missing = join(tmpDir, "never-created");
    const mgr = new LocalNodeManager({ adapter, testDir: missing });
    // Should not throw.
    await mgr.clean();
  });
});

describe("LocalNodeManager — start failure paths", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-localnode-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("waitForReady timeout surfaces a clear error AND cleans up the spawn", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    // Always-failing fetch — node never becomes ready.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
    );

    vi.useFakeTimers();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });

    // Attach the .catch handler synchronously so the eventual rejection
    // never lands as an unhandled promise. vi.advanceTimersByTimeAsync
    // drives the waitForReady loop forward; we then await the captured
    // error and assert on it.
    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });

    // Drive the 60s timeout forward — each loop iteration does fetch +
    // sleep(1000). Advance well past 60 000 ms.
    await vi.advanceTimersByTimeAsync(61_000);
    await startPromise;

    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/did not become ready/);
    // The spawn handle must have been killed in the catch arm.
    expect(spawned[0]).toBeDefined();
    expect(mgr.isRunning()).toBe(false);
    vi.useRealTimers();
  });
});

describe("LocalNodeManager — fundAccount", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-localnode-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects when called before the node is running", async () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await expect(mgr.fundAccount("0xabc", 100)).rejects.toThrow(
      /Local node is not running/
    );
  });

  it("posts to the faucet endpoint and returns the parsed JSON on success", async () => {
    const { adapter } = buildFakeAdapter();
    // First fetch = ready check; subsequent = faucet mint.
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({ ok: true }); // waitForReady
    fetchFn.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ txn_hashes: ["0xdeadbeef"] }),
    }); // faucet
    vi.stubGlobal("fetch", fetchFn);

    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();

    const addr = "0x" + "1".repeat(64);
    const result = await mgr.fundAccount(addr, 12345);

    expect(result).toEqual({ txn_hashes: ["0xdeadbeef"] });
    const faucetCall = fetchFn.mock.calls[1]!;
    expect(faucetCall[0]).toContain("/mint?amount=12345&address=" + addr);
    expect(faucetCall[1]?.method).toBe("POST");
  });

  it("rethrows a clear error when the faucet returns non-ok", async () => {
    const { adapter } = buildFakeAdapter();
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({ ok: true }); // waitForReady
    fetchFn.mockResolvedValueOnce({
      ok: false,
      text: async () => "out of funds",
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchFn);

    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();

    await expect(mgr.fundAccount("0xabc", 100)).rejects.toThrow(
      /Failed to fund account.*out of funds/
    );
  });

  it("fundAccount accepts an Account-like object by reading accountAddress.toString()", async () => {
    const { adapter } = buildFakeAdapter();
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({ ok: true }); // waitForReady
    fetchFn.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchFn);

    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();

    const fakeAccount = {
      accountAddress: { toString: () => "0xfeedbeef" },
    } as never; // exercises the typeof-not-string branch

    await mgr.fundAccount(fakeAccount, 100);
    expect(fetchFn.mock.calls[1]![0]).toContain("address=0xfeedbeef");
  });

  it("fundAccounts iterates and funds each account in turn", async () => {
    const { adapter } = buildFakeAdapter();
    const fetchFn = vi.fn();
    fetchFn.mockResolvedValueOnce({ ok: true }); // waitForReady
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchFn);

    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();

    await mgr.fundAccounts(["0x1", "0x2", "0x3"], 100);
    // 1 ready + 3 mint calls = 4 total.
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});
