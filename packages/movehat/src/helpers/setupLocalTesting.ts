import { join } from "path";
import { existsSync } from "fs";
import { initRuntime } from "../runtime.js";
import type { MovehatRuntime } from "../types/runtime.js";
import { ForkManager } from "../fork/manager.js";
import { ForkServer } from "../fork/server.js";
import { LocalNodeManager } from "../node/LocalNodeManager.js";
import { AccountManager } from "../core/AccountManager.js";
import { logger } from "../ui/index.js";
import type { LocalTestOptions } from "../types/config.js";

/**
 * Context returned by {@link setupLocalTesting}.
 *
 * Replaces the module-scoped singletons that previously tracked the
 * "current" local node / fork server / fork manager. Each invocation now
 * owns its own handles, so two parallel `setupLocalTesting` calls in the
 * same process do not trample each other.
 *
 * @public The `runtime` and `teardown` fields are the supported surface.
 *         `localNode`, `forkServer`, and `forkManager` are exposed for
 *         escape hatches (e.g. mid-test `forkManager.resetState()`) but
 *         their concrete shapes are considered `@internal` until the M5
 *         TypeDoc pass formalizes the public API.
 */
export interface LocalTestingContext {
  runtime: MovehatRuntime;
  /** @internal */
  localNode?: LocalNodeManager;
  /** @internal */
  forkServer?: ForkServer;
  /** @internal */
  forkManager?: ForkManager;
  /** Stop the local node and/or fork server owned by this context. */
  teardown: () => Promise<void>;
}

/**
 * Setup a local testing environment with either a local node or fork server
 *
 * This function provides a complete local testing setup similar to Hardhat:
 *
 * **Local Node Mode** (default, recommended):
 * 1. Starts a full Movement node locally
 * 2. Generates and funds test accounts from local faucet
 * 3. Auto-deploys modules (works because node can process transactions)
 * 4. Returns runtime ready to use
 *
 * **Fork Mode** (faster, read-only):
 * 1. Creates/loads a fork of testnet
 * 2. Starts a fork server
 * 3. Generates and funds accounts (in fork state only)
 * 4. Cannot auto-deploy (fork is read-only)
 * 5. Returns runtime for reading data
 *
 * @param options Configuration options for local testing
 * @returns LocalTestingContext with runtime and a teardown closure
 *
 * @example
 * ```typescript
 * // Local node mode (default) - Full blockchain, can deploy
 * const ctx = await setupLocalTesting({
 *   mode: 'local-node',
 *   accountLabels: ['alice', 'bob'],
 *   autoDeploy: ['counter'],  // works
 * });
 * // ...use ctx.runtime...
 * await ctx.teardown();
 * ```
 */
export async function setupLocalTesting(
  options: LocalTestOptions = {}
): Promise<LocalTestingContext> {
  const mode = options.mode || 'local-node';
  const autoFund = options.autoFund !== false;
  const defaultBalance = options.defaultBalance || 100_000_000;
  const accountLabels = options.accountLabels || ["deployer", "alice", "bob"];

  logger.newline();
  logger.step("Setting up local testing environment...");
  logger.plain(`   Mode: ${mode}`);
  logger.plain(`   Accounts: ${accountLabels.join(", ")}`);
  logger.newline();

  if (mode === 'local-node') {
    const { runtime, localNode } = await setupWithLocalNode(
      options, accountLabels, autoFund, defaultBalance
    );
    return {
      runtime,
      localNode,
      teardown: async () => {
        logger.newline();
        logger.step("Stopping local testing environment...");
        await localNode.stop();
        logger.success("Environment stopped");
        logger.newline();
      },
    };
  } else {
    const { runtime, forkServer, forkManager } = await setupWithFork(
      options, accountLabels, autoFund, defaultBalance
    );
    return {
      runtime,
      forkServer,
      forkManager,
      teardown: async () => {
        logger.newline();
        logger.step("Stopping local testing environment...");
        await forkServer.stop();
        logger.success("Environment stopped");
        logger.newline();
      },
    };
  }
}

/**
 * Setup using local Movement node (full blockchain)
 */
async function setupWithLocalNode(
  options: LocalTestOptions,
  accountLabels: readonly string[],
  autoFund: boolean,
  defaultBalance: number
): Promise<{ runtime: MovehatRuntime; localNode: LocalNodeManager }> {
  const nodeTestDir = options.nodeTestDir || join(process.cwd(), ".movehat", "local-node");
  const nodeForceRestart = options.nodeForceRestart !== false;
  const nodeFaucetPort = options.nodeFaucetPort || 8081;
  const nodeApiPort = options.nodeApiPort || 8080;
  const nodeReadyPort = options.nodeReadyPort || 8070;
  const nodeSilent = options.nodeSilent ?? false;

  const localNode = new LocalNodeManager({
    testDir: nodeTestDir,
    forceRestart: nodeForceRestart,
    faucetPort: nodeFaucetPort,
    apiPort: nodeApiPort,
    readyPort: nodeReadyPort,
    silent: nodeSilent,
  });

  const nodeInfo = await localNode.start();

  // Once the node is up, every later step (account creation, funding,
  // runtime init, autoDeploy) is fallible. If any of them throws we
  // must stop the node we just started — otherwise the child process
  // leaks and port 8080 stays bound until the OS reaps it (manifests as
  // "Movement command failed" on the next test:example run).
  try {
    logger.step(`Generating ${accountLabels.length} test accounts...`);
    const accounts = AccountManager.createBatch(accountLabels);

    for (const [label, account] of Object.entries(accounts)) {
      logger.plain(`   ${label}: ${account.accountAddress.toString()}`);
    }
    logger.newline();

    if (autoFund) {
      const accountsList = Object.values(accounts);
      await localNode.fundAccounts(accountsList, defaultBalance);
    }

    logger.step("Initializing runtime for local network...");

    const deployerPrivateKey = AccountManager.exportPrivateKeys(["deployer"]).deployer;

    if (!deployerPrivateKey) {
      throw new Error("Failed to get deployer private key");
    }

    const runtime = await initRuntime({
      network: "local",
      configOverride: {
        networks: {
          local: {
            url: `${nodeInfo.rpcUrl}/v1`,
            chainId: "local",
          },
        },
        accounts: [deployerPrivateKey],
      },
    });

    logger.success("Runtime initialized");
    logger.newline();

    if (options.autoDeploy && options.autoDeploy.length > 0) {
      logger.step(`Auto-deploying ${options.autoDeploy.length} module(s)...`);

      const previousRedeploy = process.env.MH_CLI_REDEPLOY;
      process.env.MH_CLI_REDEPLOY = 'true';

      try {
        for (const moduleName of options.autoDeploy) {
          try {
            logger.plain(`   Deploying ${moduleName}...`);
            await runtime.deployContract(moduleName);
            logger.success(`${moduleName} deployed`, 2);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to deploy ${moduleName}: ${msg}`, 2);
            throw error;
          }
        }
      } finally {
        if (previousRedeploy === undefined) {
          delete process.env.MH_CLI_REDEPLOY;
        } else {
          process.env.MH_CLI_REDEPLOY = previousRedeploy;
        }
      }

      logger.newline();
    }

    logger.success("Local testing environment ready!");
    logger.newline();
    logger.plain(`   Mode: local-node`);
    logger.plain(`   RPC: ${nodeInfo.rpcUrl}/v1`);
    logger.plain(`   Faucet: ${nodeInfo.faucetUrl}`);
    logger.plain(`   Accounts: ${Array.from(accountLabels).join(", ")}`);
    logger.plain(`   Balance per account: ${defaultBalance / 100_000_000} APT`);
    logger.newline();

    return { runtime, localNode };
  } catch (error) {
    // Best-effort cleanup. Swallow the stop() error so the original
    // setup failure surfaces unchanged.
    await localNode.stop().catch(() => {});
    throw error;
  }
}

/**
 * Setup using fork server (read-only)
 */
async function setupWithFork(
  options: LocalTestOptions,
  accountLabels: readonly string[],
  autoFund: boolean,
  defaultBalance: number
): Promise<{ runtime: MovehatRuntime; forkServer: ForkServer; forkManager: ForkManager }> {
  const forkNetwork = options.forkNetwork || "testnet";
  const forkName = options.forkName || "test-local";
  const forkPort = options.forkPort || 8080;
  const forkResetState = options.forkResetState !== false;

  logger.plain(`   Fork network: ${forkNetwork}`);
  logger.plain(`   Fork name: ${forkName}`);
  logger.plain(`   Server port: ${forkPort}`);
  logger.newline();

  if (options.autoDeploy && options.autoDeploy.length > 0) {
    logger.warning("Auto-deploy doesn't work in fork mode (read-only).");
    logger.plain("   Switch to 'local-node' mode for deployment support.");
    logger.newline();
  }

  const forkPath = join(process.cwd(), ".movehat", "forks", forkName);
  const forkManager = new ForkManager(forkPath);

  const forkExists = existsSync(join(forkPath, "metadata.json"));

  if (!forkExists) {
    logger.step(`Creating fork from ${forkNetwork}...`);
    const testnetRpc = "https://testnet.movementnetwork.xyz/v1";
    await forkManager.initialize(testnetRpc, forkNetwork, options.forkApiKey);
    logger.success(`Fork created at ${forkPath}`);
    logger.newline();
  } else {
    logger.success(`Loading existing fork from ${forkPath}`);
    // setApiKey BEFORE load() so the reconstructed MovementApiClient
    // picks up the header. load() rebuilds the client using current
    // apiKey state.
    if (options.forkApiKey !== undefined) {
      forkManager.setApiKey(options.forkApiKey);
    }
    forkManager.load();

    if (forkResetState) {
      logger.step("Resetting fork state...");
      await forkManager.resetState();
    }

    logger.newline();
  }

  logger.step(`Starting fork server on port ${forkPort}...`);
  const forkServer = new ForkServer(forkPath, forkPort);

  await forkServer.start();
  logger.success(`Fork server running at http://localhost:${forkPort}`);
  logger.newline();

  // Same cleanup-on-failure pattern as setupWithLocalNode: once the
  // fork server is listening, any later throw must stop the server or
  // we leak the listener.
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));

    logger.step(`Generating ${accountLabels.length} test accounts...`);
    const accounts = AccountManager.createBatch(accountLabels);

    for (const [label, account] of Object.entries(accounts)) {
      logger.plain(`   ${label}: ${account.accountAddress.toString()}`);
    }
    logger.newline();

    if (autoFund) {
      const addresses = Object.values(accounts).map((acc) =>
        acc.accountAddress.toString()
      );
      await forkManager.fundMultipleAccounts(addresses, defaultBalance);
    }

    logger.step("Initializing runtime for local network...");

    const deployerPrivateKey = AccountManager.exportPrivateKeys(["deployer"]).deployer;

    if (!deployerPrivateKey) {
      throw new Error("Failed to get deployer private key");
    }

    const runtime = await initRuntime({
      network: "local",
      configOverride: {
        networks: {
          local: {
            url: `http://localhost:${forkPort}/v1`,
            chainId: "local",
          },
        },
        accounts: [deployerPrivateKey],
      },
    });

    logger.success("Runtime initialized");
    logger.newline();
    logger.success("Local testing environment ready!");
    logger.newline();
    logger.plain(`   Mode: fork (read-only)`);
    logger.plain(`   RPC: http://localhost:${forkPort}/v1`);
    logger.plain(`   Accounts: ${Array.from(accountLabels).join(", ")}`);
    logger.plain(`   Balance per account: ${defaultBalance / 100_000_000} APT`);
    logger.newline();

    return { runtime, forkServer, forkManager };
  } catch (error) {
    await forkServer.stop().catch(() => {});
    throw error;
  }
}
