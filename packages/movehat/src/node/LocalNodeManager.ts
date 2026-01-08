import { spawn, ChildProcess } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { Account } from "@aptos-labs/ts-sdk";

export interface LocalNodeOptions {
  testDir?: string;           // Directory for node data (default: .movehat/local-node)
  forceRestart?: boolean;     // Clean state and start fresh
  faucetPort?: number;        // Faucet port (default: 8081)
  apiPort?: number;           // API/RPC port (default: 8080)
  readyPort?: number;         // Ready server port (default: 8070)
  silent?: boolean;           // Suppress node output
}

export interface LocalNodeInfo {
  rpcUrl: string;
  faucetUrl: string;
  readyUrl: string;
  testDir: string;
}

/**
 * Manages the lifecycle of a local Movement node
 *
 * This class handles:
 * - Starting/stopping a local Movement node
 * - Health checks and ready detection
 * - Auto-funding from the built-in faucet
 * - Cleanup on shutdown
 */
export class LocalNodeManager {
  private process: ChildProcess | null = null;
  private options: Required<LocalNodeOptions>;
  private starting: boolean = false;

  constructor(options: LocalNodeOptions = {}) {
    this.options = {
      testDir: options.testDir || join(process.cwd(), ".movehat", "local-node"),
      forceRestart: options.forceRestart ?? false,
      faucetPort: options.faucetPort || 8081,
      apiPort: options.apiPort || 8080,
      readyPort: options.readyPort || 8070,
      silent: options.silent ?? false,
    };
  }

  /**
   * Start the local Movement node
   *
   * @returns LocalNodeInfo with connection details
   */
  async start(): Promise<LocalNodeInfo> {
    if (this.process) {
      console.log("Local node already running");
      return this.getNodeInfo();
    }

    if (this.starting) {
      throw new Error("Node is already starting");
    }

    this.starting = true;

    try {
      console.log("\n🚀 Starting local Movement node...");
      console.log(`   Test directory: ${this.options.testDir}`);
      console.log(`   RPC port: ${this.options.apiPort}`);
      console.log(`   Faucet port: ${this.options.faucetPort}`);
      console.log(`   Ready port: ${this.options.readyPort}\n`);

      // Clean state if force restart
      if (this.options.forceRestart && existsSync(this.options.testDir)) {
        console.log("🧹 Cleaning previous node state...");
        rmSync(this.options.testDir, { recursive: true, force: true });
      }

      // Build command arguments
      const args = [
        "node",
        "run-localnet",
        "--test-dir", this.options.testDir,
        "--faucet-port", this.options.faucetPort.toString(),
        "--ready-server-listen-port", this.options.readyPort.toString(),
        "--assume-yes", // Auto-accept prompts
      ];

      if (this.options.forceRestart) {
        args.push("--force-restart");
      }

      // Start the node process
      this.process = spawn("movement", args, {
        stdio: this.options.silent ? "ignore" : "pipe",
        detached: false,
      });

      // Handle process output
      if (!this.options.silent && this.process.stdout && this.process.stderr) {
        this.process.stdout.on("data", (data) => {
          const output = data.toString().trim();
          if (output) {
            console.log(`[Node] ${output}`);
          }
        });

        this.process.stderr.on("data", (data) => {
          const output = data.toString().trim();
          if (output && !output.includes("WARN")) {
            console.error(`[Node Error] ${output}`);
          }
        });
      }

      // Handle process exit
      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.error(`\n❌ Local node exited with code ${code}`);
        }
        this.process = null;
      });

      this.process.on("error", (error) => {
        console.error(`\n❌ Failed to start local node: ${error.message}`);
        this.process = null;
      });

      // Wait for node to be ready
      console.log("⏳ Waiting for node to be ready...");
      await this.waitForReady(60000); // 60 second timeout

      console.log("✅ Local Movement node is ready!\n");

      this.starting = false;
      return this.getNodeInfo();

    } catch (error) {
      this.starting = false;

      // Cleanup on failure
      if (this.process) {
        this.process.kill();
        this.process = null;
      }

      throw error;
    }
  }

  /**
   * Stop the local node
   */
  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    console.log("\n🛑 Stopping local Movement node...");

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      this.process.once("exit", () => {
        console.log("✅ Local node stopped\n");
        this.process = null;
        resolve();
      });

      // Send SIGTERM for graceful shutdown
      this.process.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.process) {
          console.log("⚠️  Force killing node...");
          this.process.kill("SIGKILL");
        }
      }, 5000);
    });
  }

  /**
   * Check if the node is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Get node connection info
   */
  getNodeInfo(): LocalNodeInfo {
    return {
      rpcUrl: `http://127.0.0.1:${this.options.apiPort}`,
      faucetUrl: `http://127.0.0.1:${this.options.faucetPort}`,
      readyUrl: `http://127.0.0.1:${this.options.readyPort}`,
      testDir: this.options.testDir,
    };
  }

  /**
   * Wait for the node to be ready by checking the ready endpoint
   */
  private async waitForReady(timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    const readyUrl = `http://127.0.0.1:${this.options.readyPort}`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(readyUrl);

        if (response.ok) {
          return; // Node is ready!
        }
      } catch (error) {
        // Node not ready yet, continue waiting
      }

      // Wait 1 second before next check
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(
      `Local node did not become ready within ${timeoutMs / 1000} seconds. ` +
      `Check that 'movement' CLI is installed and ports ${this.options.apiPort}, ` +
      `${this.options.faucetPort}, and ${this.options.readyPort} are available.`
    );
  }

  /**
   * Fund an account using the local faucet
   *
   * @param account Account instance or address to fund
   * @param amount Amount in octas (default: 100_000_000 = 100 APT)
   */
  async fundAccount(account: Account | string, amount: number = 100_000_000): Promise<void> {
    if (!this.isRunning()) {
      throw new Error("Local node is not running. Call start() first.");
    }

    // Extract address if Account is provided
    const address = typeof account === 'string'
      ? account
      : account.accountAddress.toString();

    // Use query parameters for Aptos/Movement faucet
    const faucetUrl = `http://127.0.0.1:${this.options.faucetPort}/mint?amount=${amount}&address=${address}`;

    try {
      const response = await fetch(faucetUrl, {
        method: "POST",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Faucet request failed: ${errorText}`);
      }

      const result = await response.json();
      console.log(`  ✓ Funded ${address} with ${amount} octas`);

      return result;
    } catch (error: any) {
      throw new Error(`Failed to fund account: ${error.message}`);
    }
  }

  /**
   * Fund multiple accounts in batch
   */
  async fundAccounts(accounts: (Account | string)[], amount: number = 100_000_000): Promise<void> {
    console.log(`\n💰 Funding ${accounts.length} accounts from local faucet...`);

    for (const account of accounts) {
      await this.fundAccount(account, amount);
    }

    console.log(`✓ All accounts funded successfully\n`);
  }

  /**
   * Clean up node data directory
   */
  async clean(): Promise<void> {
    if (this.isRunning()) {
      throw new Error("Cannot clean while node is running. Stop the node first.");
    }

    if (existsSync(this.options.testDir)) {
      console.log(`🧹 Cleaning node data at ${this.options.testDir}...`);
      rmSync(this.options.testDir, { recursive: true, force: true });
      console.log("✓ Node data cleaned");
    }
  }
}
