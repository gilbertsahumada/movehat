import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MoveliteManager, findMoveliteBinary } from "../MoveliteManager.js";
import { cleanupCallbacks } from "../../core/movementProfile.js";
import type {
  ChildProcessAdapter,
  SpawnInput,
  SpawnedProcess,
} from "../../utils/childProcessAdapter.js";

/**
 * Strategy mirrors LocalNodeManager.test.ts: inject a fake
 * `ChildProcessAdapter` for full control over the spawn handle, stub
 * global `fetch` for the port probe / readiness / faucet endpoints.
 *
 * Fetch contract every start() test must honor: the FIRST fetch is the
 * port-in-use probe — it must REJECT for the port to be considered
 * free. An always-ok fetch makes both port probes "succeed" and
 * start() throws "Ports ... in use" before ever spawning.
 */

interface FakeSpawnedProcess extends SpawnedProcess {
  /** Test helper — manually trigger the "exited" promise resolution. */
  __exit: (code: number | null, signal: NodeJS.Signals | null) => void;
  killSignals: NodeJS.Signals[];
}

function buildFakeSpawned(opts: { ignoreSigterm?: boolean } = {}): FakeSpawnedProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let exitResolve!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      exitResolve = resolve;
    }
  );
  let dead = false;
  const killSignals: NodeJS.Signals[] = [];
  const proc: FakeSpawnedProcess = {
    pid: 4242,
    stdout,
    stderr,
    stdin,
    kill: (signal?: NodeJS.Signals) => {
      if (dead) return false;
      const sig = signal ?? "SIGTERM";
      killSignals.push(sig);
      if (opts.ignoreSigterm && sig === "SIGTERM") return true;
      dead = true;
      setImmediate(() => exitResolve({ code: null, signal: sig }));
      return true;
    },
    unref: vi.fn(),
    exited,
    __exit: (code, signal) => {
      if (dead) return;
      dead = true;
      exitResolve({ code, signal });
    },
    killSignals,
  };
  return proc;
}

function buildFakeAdapter(spawnOpts: { ignoreSigterm?: boolean } = {}): {
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
      const proc = buildFakeSpawned(spawnOpts);
      spawned.push(proc);
      return proc;
    },
  };
  return { adapter, calls, spawned };
}

/** Port probe rejects (port free), every later poll resolves ready. */
function stubFetchPortFreeThenReady() {
  const fn = vi
    .fn()
    .mockRejectedValueOnce(new Error("ECONNREFUSED"))
    .mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Port probe rejects (port free), the node never becomes ready. */
function stubFetchNeverReady() {
  const fn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
}

describe("MoveliteManager — start / stop / lifecycle", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("getNodeInfo defaults to port 8090 with a /v1 ready url", () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    const info = mgr.getNodeInfo();
    expect(info.rpcUrl).toBe("http://127.0.0.1:8090");
    expect(info.faucetUrl).toBe("http://127.0.0.1:8090");
    expect(info.readyUrl).toBe("http://127.0.0.1:8090/v1");
    expect(info.testDir).toBe("");
  });

  it("isRunning reports false before start", () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    expect(mgr.isRunning()).toBe(false);
  });

  it("start spawns 'movelite start --port 8090 --no-auth' via the adapter", async () => {
    const { adapter, calls, spawned } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    const info = await mgr.start();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("/bin/movelite");
    expect(calls[0]!.args).toEqual(["start", "--port", "8090", "--no-auth"]);
    expect(calls[0]!.stdio).toBe("pipe");
    expect(calls[0]!.env?.PRIVATE_KEY).toBeUndefined();
    // Both pipes must have consumers or the child blocks on a full buffer.
    expect(spawned[0]!.stdout!.listenerCount("data")).toBeGreaterThan(0);
    expect(spawned[0]!.stderr!.listenerCount("data")).toBeGreaterThan(0);
    expect(info.rpcUrl).toBe("http://127.0.0.1:8090");
    expect(mgr.isRunning()).toBe(true);
    await mgr.stop();
  });

  it("bumps to port 8091 when 8090 is busy", async () => {
    const { adapter, calls } = buildFakeAdapter();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true }) // 8090 probe: busy
      .mockRejectedValueOnce(new Error("ECONNREFUSED")) // 8091 probe: free
      .mockResolvedValue({ ok: true }); // ready
    vi.stubGlobal("fetch", fetchFn);
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    const info = await mgr.start();

    expect(calls[0]!.args).toContain("8091");
    expect(info.rpcUrl).toBe("http://127.0.0.1:8091");
    await mgr.stop();
  });

  it("throws without spawning when both ports are busy", async () => {
    const { adapter, calls } = buildFakeAdapter();
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchFn);
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    await expect(mgr.start()).rejects.toThrow(/Ports 8090 and 8091 are in use/);
    expect(calls).toHaveLength(0);
  });

  it("throws when constructed with an empty binary path", async () => {
    const { adapter } = buildFakeAdapter();
    const mgr = new MoveliteManager("", 8090, adapter);
    await expect(mgr.start()).rejects.toThrow(/movelite binary not found/);
  });

  it("can start again after stop (killed flag resets)", async () => {
    const { adapter, calls } = buildFakeAdapter();
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED")) // probe, first start
      .mockResolvedValueOnce({ ok: true }) // ready, first start
      .mockRejectedValueOnce(new Error("ECONNREFUSED")) // probe, second start
      .mockResolvedValue({ ok: true }); // ready, second start
    vi.stubGlobal("fetch", fetchFn);
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    await mgr.start();
    await mgr.stop();
    expect(mgr.isRunning()).toBe(false);

    await mgr.start();
    expect(calls).toHaveLength(2);
    expect(mgr.isRunning()).toBe(true);
    await mgr.stop();
  });
});

describe("MoveliteManager — subprocess output filtering (§9 console UX)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    delete process.env.MOVEHAT_VERBOSE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MOVEHAT_VERBOSE;
  });

  async function startedManager() {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    await mgr.start();
    return { mgr, proc: spawned[0]! };
  }

  it("hides routine stdout chatter in quiet mode", async () => {
    const { mgr, proc } = await startedManager();
    logSpy.mockClear();

    proc.stdout!.emit("data", Buffer.from("block committed height=42"));
    proc.stdout!.emit("data", Buffer.from("tx executed gas_used=7"));

    const stdoutCalls = logSpy.mock.calls.flat().join(" ");
    expect(stdoutCalls).not.toContain("block committed");
    expect(stdoutCalls).not.toContain("tx executed");
    await mgr.stop();
  });

  it("always surfaces panic lines as warnings, even in quiet mode", async () => {
    const { mgr, proc } = await startedManager();
    warnSpy.mockClear();

    proc.stdout!.emit("data", Buffer.from("thread 'main' panicked at 'state corrupted'"));

    const warnCalls = warnSpy.mock.calls.flat().join(" ");
    expect(warnCalls).toContain("panicked");
    await mgr.stop();
  });

  it("always surfaces critical stderr (EADDRINUSE) via logger.error", async () => {
    const { mgr, proc } = await startedManager();
    errSpy.mockClear();

    proc.stderr!.emit("data", Buffer.from("Error: listen EADDRINUSE 127.0.0.1:8090"));

    const errCalls = errSpy.mock.calls.flat().join(" ");
    expect(errCalls).toContain("EADDRINUSE");
    await mgr.stop();
  });

  it("hides routine stderr chatter in quiet mode", async () => {
    const { mgr, proc } = await startedManager();
    errSpy.mockClear();

    proc.stderr!.emit("data", Buffer.from("applying genesis state"));
    proc.stderr!.emit("data", Buffer.from("[WARN] deprecated config field"));

    const errCalls = errSpy.mock.calls.flat().join(" ");
    expect(errCalls).not.toContain("applying genesis state");
    expect(errCalls).not.toContain("deprecated config field");
    await mgr.stop();
  });

  it("surfaces stdout chatter with the muted prefix in verbose mode", async () => {
    process.env.MOVEHAT_VERBOSE = "1";
    const { mgr, proc } = await startedManager();
    logSpy.mockClear();

    // Two chunks: the handler must stay attached across emissions.
    proc.stdout!.emit("data", Buffer.from("block committed height=42"));
    proc.stdout!.emit("data", Buffer.from("tx executed gas_used=7"));

    const stdoutCalls = logSpy.mock.calls.flat().join(" ");
    expect(stdoutCalls).toContain("block committed height=42");
    expect(stdoutCalls).toContain("tx executed gas_used=7");
    await mgr.stop();
  });

  it("surfaces stderr chatter via console.error in verbose mode", async () => {
    process.env.MOVEHAT_VERBOSE = "1";
    const { mgr, proc } = await startedManager();
    errSpy.mockClear();

    proc.stderr!.emit("data", Buffer.from("applying genesis state"));
    proc.stderr!.emit("data", Buffer.from("opening state db"));

    const errCalls = errSpy.mock.calls.flat().join(" ");
    expect(errCalls).toContain("applying genesis state");
    expect(errCalls).toContain("opening state db");
    await mgr.stop();
  });
});

describe("MoveliteManager — boot failure and liveness", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    // A failed assertion must not leak fake timers into later tests.
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails fast with exit code and stderr tail when the child dies during boot", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchNeverReady();
    vi.useFakeTimers();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });
    await vi.advanceTimersByTimeAsync(0); // let the port probe settle and spawn happen

    const proc = spawned[0]!;
    proc.stderr!.emit("data", Buffer.from("failed to open genesis blob\nmigration mismatch"));
    proc.__exit(1, null);

    // Well under the 15s ready timeout — the liveness check must trip first.
    await vi.advanceTimersByTimeAsync(600);
    await startPromise;

    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).toMatch(/exited with code 1 before becoming ready/);
    expect(message).toContain("failed to open genesis blob");
    expect(mgr.isRunning()).toBe(false);
    vi.useRealTimers();
  });

  it("reports a spawn error (no exit code) as a failure to start", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchNeverReady();
    vi.useFakeTimers();
    const mgr = new MoveliteManager("/opt/missing/movelite", 8090, adapter);

    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });
    await vi.advanceTimersByTimeAsync(0);

    spawned[0]!.__exit(null, null); // the adapter maps spawn 'error' to this shape
    await vi.advanceTimersByTimeAsync(600);
    await startPromise;

    const message = (captured as Error).message;
    expect(message).toMatch(/failed to start/);
    expect(message).toContain("/opt/missing/movelite");
    expect(message).not.toContain("code null");
    vi.useRealTimers();
  });

  it("bounds the stderr tail to the most recent lines", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchNeverReady();
    vi.useFakeTimers();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });
    await vi.advanceTimersByTimeAsync(0);

    const proc = spawned[0]!;
    const lines = Array.from({ length: 30 }, (_, i) => `boot-line-${i + 1}`);
    proc.stderr!.emit("data", Buffer.from(lines.join("\n")));
    proc.__exit(1, null);

    await vi.advanceTimersByTimeAsync(600);
    await startPromise;

    const message = (captured as Error).message;
    expect(message).toContain("boot-line-30");
    // Trailing \n distinguishes boot-line-1 from boot-line-1x matches.
    expect(message).not.toContain("boot-line-1\n");
    expect(message).not.toContain("boot-line-5\n");
    vi.useRealTimers();
  });

  it("rejects a ready response that arrives after the child died (foreign node on the same port)", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    // Port probe rejects; the first readiness fetch is a deferred promise
    // we resolve ok only AFTER the child has died, emulating a foreign
    // node answering on the port.
    let resolveReady!: (v: { ok: boolean }) => void;
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveReady = resolve)),
      )
      .mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchFn);
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });
    await flushMicrotasks();

    spawned[0]!.__exit(1, null);
    await flushMicrotasks();
    resolveReady({ ok: true });
    await startPromise;

    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/exited with code 1/);
    expect(mgr.isRunning()).toBe(false);
  });

  it("truncates oversized stderr lines in the tail", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchNeverReady();
    vi.useFakeTimers();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });
    await vi.advanceTimersByTimeAsync(0);

    const proc = spawned[0]!;
    proc.stderr!.emit("data", Buffer.from("x".repeat(600)));
    proc.__exit(1, null);

    await vi.advanceTimersByTimeAsync(600);
    await startPromise;

    const message = (captured as Error).message;
    expect(message).toContain("x".repeat(500));
    expect(message).not.toContain("x".repeat(501));
    vi.useRealTimers();
  });

  it("ready timeout with a live child kills it and reports the port", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchNeverReady();
    vi.useFakeTimers();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    let captured: unknown;
    const startPromise = mgr.start().catch((e) => {
      captured = e;
    });

    await vi.advanceTimersByTimeAsync(15_500);
    await startPromise;

    expect((captured as Error).message).toMatch(/did not become ready within/);
    expect(spawned[0]!.killSignals).toContain("SIGKILL");
    expect(spawned[0]!.unref).not.toHaveBeenCalled();
    expect(mgr.isRunning()).toBe(false);
    vi.useRealTimers();
  });
});

describe("MoveliteManager — unref and exit hooks", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("unrefs the spawn handle exactly once after successful start", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    await mgr.start();

    expect(spawned[0]!.unref).toHaveBeenCalledTimes(1);
    await mgr.stop();
  });

  it("registers exit hooks on start and removes them on stop", async () => {
    const { adapter } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    const exitListenersBefore = process.listenerCount("exit");
    const cleanupSizeBefore = cleanupCallbacks.size;

    await mgr.start();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore + 1);
    expect(cleanupCallbacks.size).toBe(cleanupSizeBefore + 1);

    await mgr.stop();
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(cleanupCallbacks.size).toBe(cleanupSizeBefore);
  });

  it("the registered exit hook SIGKILLs the child", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    const listenersBefore = new Set(process.listeners("exit"));
    await mgr.start();
    const hook = process
      .listeners("exit")
      .find((listener) => !listenersBefore.has(listener));
    expect(hook).toBeDefined();

    (hook as () => void)();
    expect(spawned[0]!.killSignals).toContain("SIGKILL");

    await mgr.stop();
  });

  it("deregisters hooks when the child exits on its own", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    const exitListenersBefore = process.listenerCount("exit");
    const cleanupSizeBefore = cleanupCallbacks.size;

    await mgr.start();
    spawned[0]!.__exit(0, null);
    await flushMicrotasks();

    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
    expect(cleanupCallbacks.size).toBe(cleanupSizeBefore);
    expect(mgr.isRunning()).toBe(false);
  });
});

describe("MoveliteManager — stop", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends SIGTERM, awaits exit, and reports not running; second stop is a no-op", async () => {
    const { adapter, spawned } = buildFakeAdapter();
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    await mgr.start();

    await mgr.stop();
    expect(spawned[0]!.killSignals).toEqual(["SIGTERM"]);
    expect(mgr.isRunning()).toBe(false);

    await mgr.stop();
    expect(spawned[0]!.killSignals).toEqual(["SIGTERM"]);
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const { adapter, spawned } = buildFakeAdapter({ ignoreSigterm: true });
    stubFetchPortFreeThenReady();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);
    await mgr.start();

    vi.useFakeTimers();
    const stopPromise = mgr.stop();
    await vi.advanceTimersByTimeAsync(5_100);
    await stopPromise;
    vi.useRealTimers();

    expect(spawned[0]!.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(mgr.isRunning()).toBe(false);
  });
});

describe("MoveliteManager — fundAccount", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("posts to the mint endpoint with address and amount", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchFn);
    const { adapter } = buildFakeAdapter();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    await mgr.fundAccount("0xabc", 500);

    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:8090/mint?address=0xabc&amount=500",
      { method: "POST" },
    );
  });

  it("throws with the status code when the mint fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { adapter } = buildFakeAdapter();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    await expect(mgr.fundAccount("0xabc", 500)).rejects.toThrow(
      /Failed to fund account: 500/,
    );
  });

  it("fundAccounts funds each account in turn", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchFn);
    const { adapter } = buildFakeAdapter();
    const mgr = new MoveliteManager("/bin/movelite", 8090, adapter);

    const accounts = [
      { accountAddress: { toString: () => "0xaaa" } },
      { accountAddress: { toString: () => "0xbbb" } },
    ] as never[];
    await mgr.fundAccounts(accounts, 100);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]![0]).toContain("address=0xaaa");
    expect(fetchFn.mock.calls[1]![0]).toContain("address=0xbbb");
  });
});

describe("findMoveliteBinary — MOVELITE_PATH override", () => {
  let tmpDir: string;
  const savedEnv = process.env.MOVELITE_PATH;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-movelite-"));
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.MOVELITE_PATH;
    } else {
      process.env.MOVELITE_PATH = savedEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the env path when it points at an existing file", () => {
    const bin = join(tmpDir, "movelite");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    process.env.MOVELITE_PATH = bin;
    expect(findMoveliteBinary()).toBe(realpathSync(bin));
  });

  it("throws when explicit MOVELITE_PATH does not exist", () => {
    process.env.MOVELITE_PATH = join(tmpDir, "nope");
    expect(() => findMoveliteBinary()).toThrow(/MOVELITE_PATH.*executable/);
  });

  it("supports a relative explicit MOVELITE_PATH", () => {
    const bin = join(tmpDir, "movelite");
    writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    expect(
      findMoveliteBinary({
        env: { MOVELITE_PATH: "./movelite", PATH: "" },
        projectRoot: tmpDir,
        includePackage: false,
      })
    ).toBe(realpathSync(bin));
  });

  it("accepts node_modules/.bin and globally installed PATH binaries", () => {
    const project = join(tmpDir, "project");
    const localBinDir = join(project, "node_modules", ".bin");
    const globalBinDir = join(tmpDir, "global-bin");
    mkdirSync(localBinDir, { recursive: true });
    mkdirSync(globalBinDir);
    const localBin = join(localBinDir, "movelite");
    const globalBin = join(globalBinDir, "movelite");
    writeFileSync(localBin, "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(globalBin, "#!/bin/sh\n", { mode: 0o755 });

    expect(findMoveliteBinary({ env: { PATH: localBinDir }, includePackage: false }))
      .toBe(realpathSync(localBin));
    expect(findMoveliteBinary({ env: { PATH: globalBinDir }, includePackage: false }))
      .toBe(realpathSync(globalBin));
  });

  it("skips invalid automatic PATH candidates and keeps searching", () => {
    const invalidDir = join(tmpDir, "invalid");
    const validDir = join(tmpDir, "valid");
    mkdirSync(invalidDir);
    mkdirSync(validDir);
    writeFileSync(join(invalidDir, "movelite"), "not executable", { mode: 0o600 });
    const valid = join(validDir, "movelite");
    writeFileSync(valid, "#!/bin/sh\n", { mode: 0o755 });
    expect(
      findMoveliteBinary({
        env: { PATH: `${invalidDir}${require("node:path").delimiter}${validDir}` },
        includePackage: false,
      })
    ).toBe(realpathSync(valid));
  });
});
