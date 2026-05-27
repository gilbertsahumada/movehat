import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import type { Account } from "@aptos-labs/ts-sdk";
import type { LocalNodeInfo } from "./LocalNodeManager.js";
import { logger } from "../ui/index.js";

export class MvliteManager {
  private process: ChildProcess | null = null;
  private port: number;
  private killed = false;

  constructor(port = 8090) {
    this.port = port;
  }

  async start(): Promise<LocalNodeInfo> {
    const binary = findMvliteBinary();
    if (!binary) {
      throw new Error("mvlite binary not found");
    }

    logger.step("Starting mvlite...");

    this.process = spawn(binary, ["start", "--port", String(this.port)], {
      stdio: "pipe",
      detached: false,
    });

    this.process.on("exit", () => {
      this.process = null;
    });

    await this.waitForReady();
    logger.success(`mvlite ready on port ${this.port}`);

    return this.getNodeInfo();
  }

  private async waitForReady(): Promise<void> {
    const url = `http://127.0.0.1:${this.port}/v1`;
    const timeout = 15_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`mvlite did not become ready within ${timeout}ms`);
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
    if (!this.process || this.killed) return;
    this.killed = true;
    this.process.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.process) this.process.kill("SIGKILL");
        resolve();
      }, 5_000);
      if (this.process) {
        this.process.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });

    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null && !this.killed;
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

export function findMvliteBinary(): string | null {
  if (process.env.MVLITE_PATH) {
    return existsSync(process.env.MVLITE_PATH)
      ? process.env.MVLITE_PATH
      : null;
  }

  const platforms: Record<string, string> = {
    "darwin-arm64": "mvlite-darwin-arm64",
    "darwin-x64": "mvlite-darwin-x64",
    "linux-x64": "mvlite-linux-x64",
    "linux-arm64": "mvlite-linux-arm64",
  };

  const key = `${process.platform}-${process.arch}`;
  const pkg = platforms[key];
  if (pkg) {
    try {
      const pkgPath = require.resolve(`${pkg}/package.json`);
      const binPath = join(pkgPath, "..", "bin", "mvlite");
      if (existsSync(binPath)) return binPath;
    } catch {
      // package not installed
    }
  }

  try {
    const { execSync } = require("child_process");
    const path = execSync("which mvlite", { encoding: "utf-8" }).trim();
    if (path && existsSync(path)) return path;
  } catch {
    // not in PATH
  }

  return null;
}
