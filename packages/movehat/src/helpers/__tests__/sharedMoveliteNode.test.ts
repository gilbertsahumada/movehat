import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeProvider } from "../../node/NodeProvider.js";
import type { LocalNodeInfo } from "../../node/LocalNodeManager.js";
import {
  acquireSharedMoveliteNode,
  _resetSharedMoveliteNode,
} from "../sharedMoveliteNode.js";

const NODE_INFO: LocalNodeInfo = {
  rpcUrl: "http://127.0.0.1:8090",
  faucetUrl: "http://127.0.0.1:8090",
  readyUrl: "http://127.0.0.1:8090",
  testDir: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakeNode(opts?: { startResult?: Promise<LocalNodeInfo> }) {
  let running = false;
  const start = vi.fn(async () => {
    const info = await (opts?.startResult ?? Promise.resolve(NODE_INFO));
    running = true;
    return info;
  });
  const stop = vi.fn(async () => {
    running = false;
  });
  const node: NodeProvider = {
    start,
    stop,
    isRunning: () => running,
    getNodeInfo: () => NODE_INFO,
    fundAccounts: vi.fn(async () => {}),
  };
  return {
    node,
    start,
    stop,
    setRunning(value: boolean) {
      running = value;
    },
  };
}

describe("acquireSharedMoveliteNode", () => {
  beforeEach(() => {
    _resetSharedMoveliteNode();
  });

  it("boots the node on first acquire and returns it with its info", async () => {
    const fake = makeFakeNode();
    const factory = vi.fn(() => fake.node);

    const { node, nodeInfo } = await acquireSharedMoveliteNode(factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(node).toBe(fake.node);
    expect(nodeInfo).toEqual(NODE_INFO);
  });

  it("reuses the running node on later acquires without re-creating", async () => {
    const fake = makeFakeNode();
    const first = await acquireSharedMoveliteNode(() => fake.node);

    const laterFactory = vi.fn(() => makeFakeNode().node);
    const second = await acquireSharedMoveliteNode(laterFactory);

    expect(laterFactory).not.toHaveBeenCalled();
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(second.node).toBe(first.node);
  });

  it("dedupes concurrent first callers onto one boot", async () => {
    const gate = deferred<LocalNodeInfo>();
    const fake = makeFakeNode({ startResult: gate.promise });
    const factory = vi.fn(() => fake.node);

    const acquireA = acquireSharedMoveliteNode(factory);
    const acquireB = acquireSharedMoveliteNode(factory);
    gate.resolve(NODE_INFO);

    const [a, b] = await Promise.all([acquireA, acquireB]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(a.node).toBe(b.node);
  });

  it("boot failure rejects every waiter, clears the memo, and a retry boots fresh", async () => {
    const boom = new Error("boot failed");
    const failing = makeFakeNode({ startResult: Promise.reject(boom) });

    const acquireA = acquireSharedMoveliteNode(() => failing.node);
    const acquireB = acquireSharedMoveliteNode(() => failing.node);
    await expect(acquireA).rejects.toBe(boom);
    await expect(acquireB).rejects.toBe(boom);

    const fresh = makeFakeNode();
    const retry = await acquireSharedMoveliteNode(() => fresh.node);
    expect(retry.node).toBe(fresh.node);
    expect(fresh.start).toHaveBeenCalledTimes(1);
  });

  it("replaces a memoized node that is no longer running, without stopping it", async () => {
    const stopped = makeFakeNode();
    await acquireSharedMoveliteNode(() => stopped.node);
    stopped.setRunning(false);

    const fresh = makeFakeNode();
    const { node } = await acquireSharedMoveliteNode(() => fresh.node);

    expect(node).toBe(fresh.node);
    expect(stopped.stop).not.toHaveBeenCalled();
  });

  it("_resetSharedMoveliteNode clears the memo without stopping the node", async () => {
    const first = makeFakeNode();
    await acquireSharedMoveliteNode(() => first.node);

    _resetSharedMoveliteNode();

    const fresh = makeFakeNode();
    const { node } = await acquireSharedMoveliteNode(() => fresh.node);
    expect(node).toBe(fresh.node);
    expect(first.stop).not.toHaveBeenCalled();
  });
});
