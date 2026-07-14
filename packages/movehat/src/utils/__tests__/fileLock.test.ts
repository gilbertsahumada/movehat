import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withFileLock, withFileLocks } from "../fileLock.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function lockDir(): string {
  const root = mkdtempSync(join(tmpdir(), "movehat-lock-test-"));
  roots.push(root);
  return join(root, "locks");
}

describe("withFileLock", () => {
  it("serializes callers sharing a key and removes the lock afterwards", async () => {
    const dir = lockDir();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = withFileLock("same", async () => {
      events.push("first:start");
      await gate;
      events.push("first:end");
    }, { lockDir: dir, pollMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withFileLock("same", async () => {
      events.push("second:start");
    }, { lockDir: dir, pollMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(events).toEqual(["first:start"]);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("removes a stale lock whose owner is gone", async () => {
    const dir = lockDir();
    let seenFile = "";
    await withFileLock("stale", async () => {
      seenFile = readdirSync(dir)[0] ?? "";
    }, { lockDir: dir });
    const path = join(dir, seenFile);
    writeFileSync(path, JSON.stringify({ token: "old", pid: 999_999_999, createdAt: 0 }));
    const old = new Date(0);
    utimesSync(path, old, old);

    await expect(withFileLock("stale", async () => "ok", { lockDir: dir, pollMs: 5 }))
      .resolves.toBe("ok");
  });

  it("acquires multiple keys in stable order", async () => {
    const dir = lockDir();
    await expect(withFileLocks(["b", "a", "b"], async () => 42, { lockDir: dir }))
      .resolves.toBe(42);
    expect(readdirSync(dir)).toEqual([]);
  });
});
