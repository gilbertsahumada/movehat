import { describe, it, expect } from "vitest";
import { withKeyedLock } from "../keyedMutex.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("withKeyedLock", () => {
  it("serializes same-key calls in FIFO order", async () => {
    const events: string[] = [];
    const gate = deferred();

    const first = withKeyedLock("k", async () => {
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
    });
    const second = withKeyedLock("k", async () => {
      events.push("second:start");
      events.push("second:end");
    });

    // Give the second call every chance to start early if the lock leaked.
    await new Promise((res) => setImmediate(res));
    expect(events).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });

  it("rejection reaches its own caller and does not block the next waiter", async () => {
    const boom = new Error("boom");
    const first = withKeyedLock("k", async () => {
      throw boom;
    });
    const second = withKeyedLock("k", async () => "ok");

    await expect(first).rejects.toBe(boom);
    await expect(second).resolves.toBe("ok");
  });

  it("distinct keys run concurrently", async () => {
    const gateA = deferred();
    let aStarted = false;

    const a = withKeyedLock("a", async () => {
      aStarted = true;
      await gateA.promise;
    });
    const b = withKeyedLock("b", async () => "b-done");

    await expect(b).resolves.toBe("b-done");
    expect(aStarted).toBe(true);

    gateA.resolve();
    await a;
  });

  it("releases the key once all waiters settle", async () => {
    await withKeyedLock("k", async () => {});

    // With the entry cleaned up, a fresh call must run immediately rather
    // than chain behind a stale settled tail.
    let ran = false;
    await withKeyedLock("k", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("returns fn's resolved value", async () => {
    await expect(withKeyedLock("k", async () => 42)).resolves.toBe(42);
  });
});
