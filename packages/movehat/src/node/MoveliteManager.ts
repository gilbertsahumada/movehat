import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
import type { Account } from "@aptos-labs/ts-sdk";
import { CRITICAL_NODE_OUTPUT, type LocalNodeInfo } from "./LocalNodeManager.js";
import type { NodeProvider } from "./NodeProvider.js";
import {
  defaultChildProcessAdapter,
  type ChildProcessAdapter,
  type SpawnedProcess,
} from "../utils/childProcessAdapter.js";
import { cleanupCallbacks, ensureSignalHandler } from "../core/movementProfile.js";
import { logger, isVerbose, colors, symbols } from "../ui/index.js";

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 200;
const SIGKILL_GRACE_MS = 5_000;
const MAX_STDERR_TAIL_LINES = 20;
const MAX_STDERR_TAIL_LINE_LENGTH = 500;

export class MoveliteManager implements NodeProvider {
  private spawned: SpawnedProcess | null = null;
  private port: number;
  private killed = false;
  private readonly binaryPath: string;
  private readonly adapter: ChildProcessAdapter;
  private readonly stderrTail: string[] = [];
  private exitHook: (() => void) | null = null;

  constructor(
    binaryPath: string,
    port = 8090,
    adapter: ChildProcessAdapter = defaultChildProcessAdapter,
  ) {
    this.binaryPath = binaryPath;
    this.port = port;
    this.adapter = adapter;
  }

  async start(): Promise<LocalNodeInfo> {
    const binary = this.binaryPath;
    if (!binary) {
      throw new Error("movelite binary not found");
    }

    if (await this.isPortInUse(this.port)) {
      this.port = this.port + 1;
      if (await this.isPortInUse(this.port)) {
        throw new Error(`Ports ${this.port - 1} and ${this.port} are in use`);
      }
    }

    logger.step("Starting movelite...");

    this.killed = false;
    this.stderrTail.length = 0;

    const spawned = this.adapter.spawn({
      command: binary,
      args: ["start", "--port", String(this.port), "--no-auth"],
      stdio: "pipe",
    });
    this.spawned = spawned;

    // An undrained pipe fills its 64KB buffer and blocks the node's
    // writes, so stdout/stderr must always be consumed.
    spawned.stdout?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (!output) return;
      if (CRITICAL_NODE_OUTPUT.test(output)) {
        logger.warning(output);
        return;
      }
      if (isVerbose()) {
        for (const line of output.split("\n")) {
          if (line) console.log(`  ${colors.muted(symbols.pointer + " " + line)}`);
        }
      }
    });

    spawned.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (!output) return;
      for (const line of output.split("\n")) {
        if (!line) continue;
        this.stderrTail.push(line.slice(0, MAX_STDERR_TAIL_LINE_LENGTH));
        if (this.stderrTail.length > MAX_STDERR_TAIL_LINES) {
          this.stderrTail.shift();
        }
      }
      if (CRITICAL_NODE_OUTPUT.test(output)) {
        logger.error(output);
        return;
      }
      if (isVerbose()) {
        for (const line of output.split("\n")) {
          if (line) console.error(`  ${colors.muted(symbols.pointer + " " + line)}`);
        }
      }
    });

    // The 'exit' handler gets one synchronous turn and no supervisor
    // remains to escalate afterwards, so the reap must be SIGKILL. The
    // guard covers the double invocation on signals (cleanupCallbacks
    // runs first, then process.exit fires 'exit').
    let hookFired = false;
    const exitHook = () => {
      if (hookFired) return;
      hookFired = true;
      spawned.kill("SIGKILL");
    };
    this.exitHook = exitHook;
    ensureSignalHandler();
    cleanupCallbacks.add(exitHook);
    process.on("exit", exitHook);

    void spawned.exited.then(({ code }) => {
      if (code !== null && code !== 0 && !this.killed) {
        logger.error(`movelite exited with code ${code}`);
      }
      this.deregisterExitHook(exitHook);
      if (this.spawned === spawned) {
        this.spawned = null;
      }
    });

    try {
      await this.waitForReady(spawned);
    } catch (err) {
      spawned.kill("SIGKILL");
      this.deregisterExitHook(exitHook);
      if (this.spawned === spawned) {
        this.spawned = null;
      }
      throw err;
    }

    // Unref only after readiness so an unstopped node can't keep the
    // parent's event loop alive.
    spawned.unref();

    logger.success(`movelite ready on port ${this.port}`);

    return this.getNodeInfo();
  }

  private deregisterExitHook(hook: () => void): void {
    cleanupCallbacks.delete(hook);
    process.removeListener("exit", hook);
    if (this.exitHook === hook) {
      this.exitHook = null;
    }
  }

  private async waitForReady(spawned: SpawnedProcess): Promise<void> {
    const url = `http://127.0.0.1:${this.port}/v1`;

    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    void spawned.exited.then((info) => {
      exitInfo = info;
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // Liveness first: a foreign node answering on the same port must
      // not mask a child that already died.
      if (exitInfo) throw this.buildBootFailure(exitInfo);
      try {
        const res = await fetch(url);
        if (res.ok && !exitInfo) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
    }

    if (exitInfo) throw this.buildBootFailure(exitInfo);
    throw new Error(
      `movelite did not become ready within ${READY_TIMEOUT_MS}ms on port ${this.port}` +
        this.stderrTailSuffix(),
    );
  }

  private buildBootFailure(exitInfo: {
    code: number | null;
    signal: NodeJS.Signals | null;
  }): Error {
    let reason: string;
    if (exitInfo.code === null && exitInfo.signal === null) {
      reason = `movelite failed to start — check that ${this.binaryPath} exists and is executable`;
    } else if (exitInfo.signal !== null) {
      reason = `movelite was killed by ${exitInfo.signal} before becoming ready`;
    } else {
      reason = `movelite exited with code ${exitInfo.code} before becoming ready`;
    }
    return new Error(reason + this.stderrTailSuffix());
  }

  private stderrTailSuffix(): string {
    if (this.stderrTail.length === 0) return "";
    return `\nRecent stderr:\n  ${this.stderrTail.join("\n  ")}`;
  }

  async fundAccount(address: string, amount: number): Promise<void> {
    const res = await fetch(
      `http://127.0.0.1:${this.port}/mint?address=${address}&amount=${amount}`,
      { method: "POST" },
    );
    if (!res.ok) {
      throw new Error(`Failed to fund account: ${res.status}`);
    }
  }

  async fundAccounts(accounts: Account[], balance: number): Promise<void> {
    for (const account of accounts) {
      await this.fundAccount(account.accountAddress.toString(), balance);
    }
  }

  async stop(): Promise<void> {
    const spawned = this.spawned;
    if (!spawned || this.killed) return;
    const hook = this.exitHook;
    this.killed = true;
    spawned.kill("SIGTERM");

    // The exited continuation nulls this.spawned — exactly the condition
    // under which skipping the SIGKILL is correct.
    const forceTimer = setTimeout(() => {
      if (this.spawned === spawned) {
        spawned.kill("SIGKILL");
      }
    }, SIGKILL_GRACE_MS);

    try {
      await spawned.exited;
    } finally {
      clearTimeout(forceTimer);
      // The hook stays armed through the grace window in case the parent
      // dies before the child does.
      if (hook) this.deregisterExitHook(hook);
      if (this.spawned === spawned) {
        this.spawned = null;
      }
    }
  }

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1`);
      return res.ok;
    } catch {
      return false;
    }
  }

  isRunning(): boolean {
    return this.spawned !== null && !this.killed;
  }

  getNodeInfo(): LocalNodeInfo {
    return {
      rpcUrl: `http://127.0.0.1:${this.port}`,
      faucetUrl: `http://127.0.0.1:${this.port}`,
      readyUrl: `http://127.0.0.1:${this.port}/v1`,
      testDir: "",
    };
  }
}

export function findMoveliteBinary(): string | null {
  if (process.env.MOVELITE_PATH) {
    return existsSync(process.env.MOVELITE_PATH)
      ? process.env.MOVELITE_PATH
      : null;
  }

  const platforms: Record<string, string> = {
    "darwin-arm64": "movelite-darwin-arm64",
    "darwin-x64": "movelite-darwin-x64",
    "linux-x64": "movelite-linux-x64",
    "linux-arm64": "movelite-linux-arm64",
  };

  const key = `${process.platform}-${process.arch}`;
  const pkg = platforms[key];
  if (pkg) {
    try {
      // Resolve through the `movelite` shim (movehat's direct dependency),
      // then resolve the platform package from movelite's own context. The
      // platform package is movelite's dependency, not movehat's, so a direct
      // resolve from here fails under pnpm/yarn strict layouts.
      const req = createRequire(import.meta.url);
      const movelitePkg = req.resolve("movelite/package.json");
      const moveliteReq = createRequire(movelitePkg);
      const pkgPath = moveliteReq.resolve(`${pkg}/package.json`);
      const binPath = join(pkgPath, "..", "bin", "movelite");
      if (existsSync(binPath)) return binPath;
    } catch {
      // package not installed
    }
  }

  try {
    const found = execSync("which movelite", { encoding: "utf-8" }).trim();
    if (found && existsSync(found)) return found;
  } catch {
    // not in PATH
  }

  return null;
}
