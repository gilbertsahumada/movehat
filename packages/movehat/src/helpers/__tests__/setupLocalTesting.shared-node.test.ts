import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Scope-guard wiring for the implicit shared movelite node: which
 * setupLocalTesting calls share the process singleton, which get a
 * private spawn, and that Harness.cleanup() never stops a shared node.
 */

const { NODE_INFO, moveliteInstances, localNodeInstances, FakeMovelite, FakeLocalNode } =
  vi.hoisted(() => {
    const NODE_INFO = {
      rpcUrl: "http://127.0.0.1:8090",
      faucetUrl: "http://127.0.0.1:8090",
      readyUrl: "http://127.0.0.1:8090",
      testDir: "",
    };

    class FakeMovelite {
      running = false;
      stopCalls = 0;
      constructor(public binaryPath: string) {
        moveliteInstances.push(this);
      }
      async start() {
        this.running = true;
        return NODE_INFO;
      }
      async stop() {
        this.stopCalls++;
        this.running = false;
      }
      isRunning() {
        return this.running;
      }
      getNodeInfo() {
        return NODE_INFO;
      }
      async fundAccounts() {}
    }

    class FakeLocalNode {
      running = false;
      stopCalls = 0;
      constructor(public options: unknown) {
        localNodeInstances.push(this);
      }
      async start() {
        this.running = true;
        return NODE_INFO;
      }
      async stop() {
        this.stopCalls++;
        this.running = false;
      }
      isRunning() {
        return this.running;
      }
      getNodeInfo() {
        return NODE_INFO;
      }
      async fundAccounts() {}
    }

    const moveliteInstances: InstanceType<typeof FakeMovelite>[] = [];
    const localNodeInstances: InstanceType<typeof FakeLocalNode>[] = [];

    return { NODE_INFO, moveliteInstances, localNodeInstances, FakeMovelite, FakeLocalNode };
  });

vi.mock("../../node/MoveliteManager.js", () => ({
  MoveliteManager: FakeMovelite,
  findMoveliteBinary: () => "/fake/movelite",
}));

vi.mock("../../node/LocalNodeManager.js", () => ({
  LocalNodeManager: FakeLocalNode,
}));

vi.mock("../../runtime.js", () => ({
  initRuntime: vi.fn(async () => ({
    accountManager: { getLabeledAccounts: () => ({}) },
  })),
}));

vi.mock("../../core/AccountManager.js", () => {
  class AccountManager {
    createBatch(labels: readonly string[]) {
      const out: Record<string, { accountAddress: { toString(): string } }> = {};
      for (const l of labels) {
        out[l] = { accountAddress: { toString: () => "0x" + "1".repeat(64) } };
      }
      return out;
    }
    exportPrivateKeys(_labels: readonly string[]) {
      return { deployer: "0x" + "1".repeat(64) };
    }
  }
  return { AccountManager };
});

// Imported after mocks so vi.hoisted ordering applies.
import { setupLocalTesting } from "../setupLocalTesting.js";
import { Harness } from "../../harness/Harness.js";
import { _resetSharedMoveliteNode } from "../sharedMoveliteNode.js";
import { logger } from "../../ui/index.js";

describe("setupLocalTesting — implicit shared movelite node", () => {
  let envBackup: string | undefined;

  beforeEach(() => {
    _resetSharedMoveliteNode();
    moveliteInstances.length = 0;
    localNodeInstances.length = 0;
    envBackup = process.env.MOVEHAT_USE_MOVELITE;
    delete process.env.MOVEHAT_USE_MOVELITE;
    for (const method of [
      "step",
      "success",
      "plain",
      "newline",
      "warning",
      "error",
      "phase",
      "kv",
    ] as const) {
      vi.spyOn(logger, method).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    if (envBackup === undefined) delete process.env.MOVEHAT_USE_MOVELITE;
    else process.env.MOVEHAT_USE_MOVELITE = envBackup;
    vi.restoreAllMocks();
  });

  it("two contexts share one movelite node; neither teardown stops it", async () => {
    const ctxA = await setupLocalTesting({ accountLabels: ["deployer"] });
    const ctxB = await setupLocalTesting({ accountLabels: ["deployer"] });

    expect(moveliteInstances).toHaveLength(1);
    expect(ctxA.ownsNode).toBe(false);
    expect(ctxB.ownsNode).toBe(false);
    expect(ctxA.localNode).toBe(ctxB.localNode);

    await ctxA.teardown();
    await ctxB.teardown();
    expect(moveliteInstances[0]!.stopCalls).toBe(0);
    expect(moveliteInstances[0]!.isRunning()).toBe(true);
  });

  it.each([
    { nodeTestDir: "/tmp/private-node" },
    { nodeForceRestart: false },
    { nodeFaucetPort: 9081 },
    { nodeApiPort: 9999 },
    { nodeReadyPort: 9070 },
    { nodeSilent: true },
  ])(
    "an explicit node option (%o) gets a private movelite that teardown stops",
    async (nodeOption) => {
      const ctx = await setupLocalTesting({
        accountLabels: ["deployer"],
        ...nodeOption,
      });

      expect(moveliteInstances).toHaveLength(1);
      expect(ctx.ownsNode).toBe(true);

      await ctx.teardown();
      expect(moveliteInstances[0]!.stopCalls).toBe(1);
    },
  );

  it("an injected localNode bypasses the singleton and is never stopped", async () => {
    const injected = new FakeMovelite("/injected");
    moveliteInstances.length = 0;
    injected.running = true;

    const ctx = await setupLocalTesting({
      accountLabels: ["deployer"],
      localNode: injected,
    });

    expect(moveliteInstances).toHaveLength(0);
    expect(ctx.ownsNode).toBe(false);
    expect(ctx.localNode).toBe(injected);

    await ctx.teardown();
    expect(injected.stopCalls).toBe(0);
  });

  it("MOVEHAT_USE_MOVELITE=0 falls through to an owned LocalNodeManager", async () => {
    process.env.MOVEHAT_USE_MOVELITE = "0";

    const ctx = await setupLocalTesting({ accountLabels: ["deployer"] });

    expect(moveliteInstances).toHaveLength(0);
    expect(localNodeInstances).toHaveLength(1);
    expect(ctx.ownsNode).toBe(true);

    await ctx.teardown();
    expect(localNodeInstances[0]!.stopCalls).toBe(1);
  });

  it("Harness.cleanup() does not stop the shared node", async () => {
    const harness = await Harness.createLocal({ accountLabels: ["deployer"] });

    expect(moveliteInstances).toHaveLength(1);
    await harness.cleanup();

    expect(moveliteInstances[0]!.stopCalls).toBe(0);
    expect(moveliteInstances[0]!.isRunning()).toBe(true);
  });
});
