import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse } from "node:path";

import { LocalNodeManager } from "../LocalNodeManager.js";
import { UnsafePathError } from "../../errors.js";
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
    unref: vi.fn(),
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

function markOwned(directory: string): void {
  writeFileSync(join(directory, ".movehat-local-node"), "movehat-managed-local-node\n", {
    mode: 0o600,
  });
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

  it("honors custom faucet/ready ports; apiPort is pinned to 8080 (see F9)", () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new LocalNodeManager({
      adapter,
      testDir: tmpDir,
      faucetPort: 9001,
      readyPort: 9002,
    });
    const info = mgr.getNodeInfo();
    // Movement CLI does not accept a flag for the REST API port; see
    // LocalNodeManager.api-port.test.ts for the F9 contract.
    expect(info.rpcUrl).toBe("http://127.0.0.1:8080");
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
    expect(args).toContain(realpathSync(tmpDir));
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

  it("start in non-silent mode wires stdout/stderr listeners that respect §9 filtering", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: false });

    await mgr.start();

    const proc = spawned[0]!;
    expect(proc.stdout!.listenerCount("data")).toBeGreaterThan(0);
    expect(proc.stderr!.listenerCount("data")).toBeGreaterThan(0);
    // Detailed filter behavior — what passes through vs what's gated
    // behind isVerbose() — lives in the "§9 console UX" describe block
    // below. This test only locks the listener-wiring contract.
  });

  it("force-restart cleans the test directory before spawn", async () => {
    const { adapter } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const planted = join(tmpDir, "stale-file.txt");
    // Create a stale file to prove the cleanup actually removes it.
    mkdirSync(tmpDir, { recursive: true });
    markOwned(tmpDir);
    writeFileSync(planted, "stale");
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

  it.each([
    ["filesystem root", parse(process.cwd()).root],
    ["cwd", process.cwd()],
    ["home", homedir()],
  ])("rejects protected %s paths", async (_label, protectedPath) => {
    const { adapter, calls } = buildFakeAdapter();
    const mgr = new LocalNodeManager({
      adapter,
      testDir: protectedPath,
      forceRestart: true,
      silent: true,
    });
    await expect(mgr.start()).rejects.toBeInstanceOf(UnsafePathError);
    expect(calls).toHaveLength(0);
  });

  it("rejects unknown non-empty directories without deleting them", async () => {
    const { adapter, calls } = buildFakeAdapter();
    writeFileSync(join(tmpDir, "user-data.txt"), "keep");
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, forceRestart: true });
    await expect(mgr.start()).rejects.toBeInstanceOf(UnsafePathError);
    expect(existsSync(join(tmpDir, "user-data.txt"))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("adopts a recognized 0.6 directory on start; clean removes one without adopting it", async () => {
    mkdirSync(join(tmpDir, "0"));
    writeFileSync(join(tmpDir, "mint.key"), "key");
    writeFileSync(join(tmpDir, "waypoint.txt"), "waypoint");
    const { adapter } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, silent: true });
    await mgr.start();
    expect(existsSync(join(tmpDir, ".movehat-local-node"))).toBe(true);
    await mgr.stop();
    await mgr.clean();
    expect(existsSync(tmpDir)).toBe(false);

    mkdirSync(tmpDir);
    mkdirSync(join(tmpDir, "0"));
    writeFileSync(join(tmpDir, "mint.key"), "key");
    writeFileSync(join(tmpDir, "waypoint.txt"), "waypoint");
    await new LocalNodeManager({ adapter, testDir: tmpDir }).clean();
    expect(existsSync(tmpDir)).toBe(false);
  });

  it("never adopts or deletes a two-sentinel directory containing user data", async () => {
    mkdirSync(join(tmpDir, "0"));
    writeFileSync(join(tmpDir, "waypoint.txt"), "waypoint");
    writeFileSync(join(tmpDir, "user-wallet.txt"), "keep me");
    const { adapter, calls } = buildFakeAdapter();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir, forceRestart: true });

    await expect(mgr.start()).rejects.toBeInstanceOf(UnsafePathError);
    expect(existsSync(join(tmpDir, "user-wallet.txt"))).toBe(true);
    expect(existsSync(join(tmpDir, ".movehat-local-node"))).toBe(false);
    expect(calls).toHaveLength(0);
    await expect(mgr.clean()).rejects.toBeInstanceOf(UnsafePathError);
    expect(existsSync(join(tmpDir, "user-wallet.txt"))).toBe(true);
  });

  it("rejects symlinked node directories", async () => {
    const target = mkdtempSync(join(tmpdir(), "movehat-node-target-"));
    const link = join(tmpDir, "linked");
    symlinkSync(target, link, "dir");
    const { adapter } = buildFakeAdapter();
    await expect(
      new LocalNodeManager({ adapter, testDir: link }).start()
    ).rejects.toBeInstanceOf(UnsafePathError);
    unlinkSync(link);
    rmSync(target, { recursive: true, force: true });
  });

  it("uses private permissions for managed state", async () => {
    const { adapter } = buildFakeAdapter();
    stubFetchAlwaysOk();
    await new LocalNodeManager({ adapter, testDir: tmpDir, silent: true }).start();
    expect(statSync(tmpDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(tmpDir, ".movehat-local-node")).mode & 0o777).toBe(0o600);
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

describe("LocalNodeManager — subprocess output filtering (§9 console UX)", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-localnode-filter-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Ensure quiet mode is the default for each test; the verbose tests
    // set MOVEHAT_VERBOSE explicitly inside their own scope.
    delete process.env.MOVEHAT_VERBOSE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MOVEHAT_VERBOSE;
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("hides routine stdout chatter from the movement node in quiet mode", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await mgr.start();

    const proc = spawned[0]!;
    logSpy.mockClear();

    // Push routine chatter — exactly the noise we used to spam to stdout.
    proc.stdout!.emit("data", Buffer.from("Loading aptos framework module"));
    proc.stdout!.emit("data", Buffer.from("Compiling Move bytecode"));
    proc.stdout!.emit("data", Buffer.from("aptos_account: account created"));

    // None of these should have reached stdout (no `[Node]` prefix, no
    // muted gray `›` prefix). The only console.log calls that may arise
    // are from the spinner mock falling back to plain text — but since
    // ora auto-disables in non-TTY (vitest is non-TTY), even those are
    // suppressed.
    const stdoutCalls = logSpy.mock.calls.flat().join(" ");
    expect(stdoutCalls).not.toContain("Loading aptos framework module");
    expect(stdoutCalls).not.toContain("Compiling Move bytecode");
    expect(stdoutCalls).not.toContain("aptos_account: account created");
  });

  it("always surfaces panic / fatal lines as warnings, even in quiet mode", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await mgr.start();

    const proc = spawned[0]!;
    warnSpy.mockClear();

    proc.stdout!.emit("data", Buffer.from("thread 'main' panicked at 'state corrupted'"));

    const warnCalls = warnSpy.mock.calls.flat().join(" ");
    expect(warnCalls).toContain("panicked");
  });

  it("surfaces 'address already in use' (port conflict) regardless of verbosity", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await mgr.start();

    const proc = spawned[0]!;
    warnSpy.mockClear();

    proc.stdout!.emit(
      "data",
      Buffer.from("error: address already in use: 127.0.0.1:8080"),
    );

    const warnCalls = warnSpy.mock.calls.flat().join(" ");
    expect(warnCalls).toContain("address already in use");
  });

  it("surfaces stdout chatter with gray prefix in verbose mode", async () => {
    process.env.MOVEHAT_VERBOSE = "1";
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await mgr.start();

    const proc = spawned[0]!;
    logSpy.mockClear();

    proc.stdout!.emit("data", Buffer.from("Loading aptos framework module"));

    const stdoutCalls = logSpy.mock.calls.flat().join(" ");
    expect(stdoutCalls).toContain("Loading aptos framework module");
  });

  it("always surfaces critical stderr (panic/EADDRINUSE) via logger.error", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await mgr.start();

    const proc = spawned[0]!;
    errSpy.mockClear();

    proc.stderr!.emit("data", Buffer.from("thread panicked: failed to bind socket"));

    const stderrCalls = errSpy.mock.calls.flat().join(" ");
    expect(stderrCalls).toContain("panicked");
  });

  it("hides routine progress stderr in quiet mode (Movement CLI emits progress to stderr too)", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchAlwaysOk();
    const mgr = new LocalNodeManager({ adapter, testDir: tmpDir });
    await mgr.start();

    const proc = spawned[0]!;
    errSpy.mockClear();

    // The movement subprocess emits progress messages to stderr that
    // are NOT errors: "Applying post startup steps...", "Compiling,
    // may take a little while...". Hiding stream channel from the
    // user keeps the console clean.
    proc.stderr!.emit("data", Buffer.from("Applying post startup steps..."));
    proc.stderr!.emit("data", Buffer.from("[WARN] deprecated config field"));

    const stderrCalls = errSpy.mock.calls.flat().join(" ");
    expect(stderrCalls).not.toContain("Applying post startup steps");
    expect(stderrCalls).not.toContain("deprecated config field");
  });
});
