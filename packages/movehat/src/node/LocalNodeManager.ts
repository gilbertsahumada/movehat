import { existsSync, rmSync } from "fs";
import { join } from "path";
import { Account } from "@aptos-labs/ts-sdk";
import {
  defaultChildProcessAdapter,
  type ChildProcessAdapter,
  type SpawnedProcess,
} from "../utils/childProcessAdapter.js";
import { logger } from "../ui/index.js";

export interface LocalNodeOptions {
  testDir?: string;           // Directory for node data (default: .movehat/local-node)
  forceRestart?: boolean;     // Clean state and start fresh
  faucetPort?: number;        // Faucet port (default: 8081)
  /**
   * REST API port. Movement CLI (`movement node run-localnet`) does
   * not accept a flag to change this — the node always binds 8080.
   * Passing any other value triggers a warning at construction time
   * and is replaced with 8080. Field is kept for source compatibility.
   *
   * @deprecated Movement CLI does not honor this. Omit it.
   */
  apiPort?: number;
  readyPort?: number;         // Ready server port (default: 8070)
  silent?: boolean;           // Suppress node output
  /**
   * Override the child-process adapter. Tests inject a fake adapter so
   * the daemon spawn never reaches the real `movement` binary.
   */
  adapter?: ChildProcessAdapter;
}

const MOVEMENT_API_PORT = 8080;

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
  private spawned: SpawnedProcess | null = null;
  private killed = false;
  private options: Required<Omit<LocalNodeOptions, "adapter">>;
  private readonly adapter: ChildProcessAdapter;
  private starting: boolean = false;

  constructor(options: LocalNodeOptions = {}) {
    this.adapter = options.adapter ?? defaultChildProcessAdapter;
    if (
      options.apiPort !== undefined &&
      options.apiPort !== MOVEMENT_API_PORT
    ) {
      // Movement CLI hardcodes the REST API port to 8080. Surfacing
      // the requested port via getNodeInfo() would lie about where
      // the node actually listens.
      logger.warning(
        `LocalNodeManager: apiPort=${options.apiPort} is not supported by ` +
          `movement node run-localnet; forcing REST API port to 8080.`
      );
    }
    this.options = {
      testDir: options.testDir || join(process.cwd(), ".movehat", "local-node"),
      forceRestart: options.forceRestart ?? false,
      faucetPort: options.faucetPort || 8081,
      apiPort: MOVEMENT_API_PORT,
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
    if (this.spawned) {
      console.log("Local node already running");
      return this.getNodeInfo();
    }

    if (this.starting) {
      throw new Error("Node is already starting");
    }

    this.starting = true;

    try {
      logger.newline();
      logger.step("Starting local Movement node...");
      logger.plain(`   Test directory: ${this.options.testDir}`);
      logger.plain(`   RPC port: ${this.options.apiPort}`);
      logger.plain(`   Faucet port: ${this.options.faucetPort}`);
      logger.plain(`   Ready port: ${this.options.readyPort}`);
      logger.newline();

      // Clean state if force restart
      if (this.options.forceRestart && existsSync(this.options.testDir)) {
        logger.step("Cleaning previous node state...");
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

      // Start the node process via the injectable adapter.
      this.killed = false;
      this.spawned = this.adapter.spawn({
        command: "movement",
        args,
        stdio: this.options.silent ? "ignore" : "pipe",
      });

      // Handle process output
      if (!this.options.silent && this.spawned.stdout && this.spawned.stderr) {
        this.spawned.stdout.on("data", (data: Buffer) => {
          const output = data.toString().trim();
          if (output) {
            console.log(`[Node] ${output}`);
          }
        });

        this.spawned.stderr.on("data", (data: Buffer) => {
          const output = data.toString().trim();
          if (output && !output.includes("WARN")) {
            console.error(`[Node Error] ${output}`);
          }
        });
      }

      // The adapter's `exited` promise settles on both natural exit and on
      // spawn-time error (e.g. ENOENT). On error the code is `null` — we don't
      // log a generic "spawn failed" message here because `waitForReady` will
      // surface a detailed timeout-with-hints error if movement never starts.
      void this.spawned.exited.then(({ code }) => {
        if (code !== null && code !== 0) {
          logger.error(`Local node exited with code ${code}`);
        }
        this.spawned = null;
      });

      // Wait for node to be ready
      logger.step("Waiting for node to be ready...");
      await this.waitForReady(60000); // 60 second timeout

      logger.success("Local Movement node is ready!");
      logger.newline();

      this.starting = false;
      return this.getNodeInfo();

    } catch (error) {
      this.starting = false;

      // Cleanup on failure
      if (this.spawned) {
        this.killed = true;
        this.spawned.kill();
        this.spawned = null;
      }

      throw error;
    }
  }

  /**
   * Stop the local node
   */
  async stop(): Promise<void> {
    if (!this.spawned) {
      return;
    }

    logger.newline();
    logger.step("Stopping local Movement node...");

    const spawned = this.spawned;

    // Mark killed synchronously so isRunning() reflects the intent right away,
    // mirroring node's ChildProcess.killed semantics.
    this.killed = true;

    // Send SIGTERM for graceful shutdown
    spawned.kill("SIGTERM");

    // Force kill after 5 seconds if still running
    const forceTimer = setTimeout(() => {
      if (this.spawned === spawned) {
        logger.warning("Force killing node...");
        spawned.kill("SIGKILL");
      }
    }, 5000);

    try {
      await spawned.exited;
      logger.success("Local node stopped");
      logger.newline();
    } finally {
      clearTimeout(forceTimer);
      if (this.spawned === spawned) {
        this.spawned = null;
      }
    }
  }

  /**
   * Check if the node is running
   */
  isRunning(): boolean {
    return this.spawned !== null && !this.killed;
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

    // Use query parameters for the Movement faucet
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
      logger.success(`Funded ${address} with ${amount} octas`, 2);

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fund account: ${msg}`);
    }
  }

  /**
   * Fund multiple accounts in batch
   */
  async fundAccounts(accounts: (Account | string)[], amount: number = 100_000_000): Promise<void> {
    logger.newline();
    logger.step(`Funding ${accounts.length} accounts from local faucet...`);

    for (const account of accounts) {
      await this.fundAccount(account, amount);
    }

    logger.success("All accounts funded successfully");
    logger.newline();
  }

  /**
   * Clean up node data directory
   */
  async clean(): Promise<void> {
    if (this.isRunning()) {
      throw new Error("Cannot clean while node is running. Stop the node first.");
    }

    if (existsSync(this.options.testDir)) {
      logger.step(`Cleaning node data at ${this.options.testDir}...`);
      rmSync(this.options.testDir, { recursive: true, force: true });
      logger.success("Node data cleaned");
    }
  }
}
