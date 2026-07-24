import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { withFileLock, withFileLocks } from "../fileLock.js";

const roots: string[] = [];
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function lockDir(): string {
  const root = mkdtempSync(join(tmpdir(), "movehat-lock-test-"));
  roots.push(root);
  const dir = join(root, "locks");
  mkdirSync(dir);
  return dir;
}

describe("withFileLock", () => {
  it("serializes callers sharing a key and removes the lock afterwards", async () => {
    const dir = lockDir();
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withFileLock(
      "same",
      async () => {
        events.push("first:start");
        await gate;
        events.push("first:end");
      },
      { lockDir: dir, pollMs: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withFileLock(
      "same",
      async () => {
        events.push("second:start");
      },
      { lockDir: dir, pollMs: 5 },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(events).toEqual(["first:start"]);
    const published = readdirSync(dir).find((name) => name.endsWith(".lock"));
    expect(JSON.parse(readFileSync(join(dir, published!), "utf8"))).toMatchObject({
      pid: process.pid,
      token: expect.any(String),
    });
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reclaims a dead owner's lock immediately", async () => {
    const dir = lockDir();
    let seenFile = "";
    await withFileLock(
      "stale",
      async () => {
        seenFile = readdirSync(dir)[0] ?? "";
      },
      { lockDir: dir },
    );
    const path = join(dir, seenFile);
    writeFileSync(
      path,
      JSON.stringify({ token: "old", pid: 999_999_999, createdAt: 0 }),
    );
    await expect(
      withFileLock("stale", async () => "ok", { lockDir: dir, pollMs: 5 }),
    ).resolves.toBe("ok");
  });

  it("never reclaims an old lock while its owner is alive", async () => {
    const dir = lockDir();
    const name = createHash("sha256").update("live").digest("hex") + ".lock";
    const path = join(dir, name);
    writeFileSync(
      path,
      JSON.stringify({ token: "live", pid: process.pid, createdAt: 0 }),
    );
    const old = new Date(0);
    utimesSync(path, old, old);
    await expect(
      withFileLock("live", async () => "bad", {
        lockDir: dir,
        pollMs: 5,
        timeoutMs: 30,
      }),
    ).rejects.toThrow("Timed out");
  });

  it("never reclaims corrupt records without a safe owner token", async () => {
    const dir = lockDir();
    const name = createHash("sha256").update("corrupt").digest("hex") + ".lock";
    const path = join(dir, name);
    writeFileSync(path, "{");
    await expect(
      withFileLock("corrupt", async () => "bad", {
        lockDir: dir,
        pollMs: 5,
        timeoutMs: 30,
      }),
    ).rejects.toThrow("Timed out");
    await expect(
      withFileLock("corrupt", async () => "bad", {
        lockDir: dir,
        pollMs: 5,
        timeoutMs: 30,
      }),
    ).rejects.toThrow("Timed out");
  });

  it("acquires multiple keys in stable order", async () => {
    const dir = lockDir();
    await expect(
      withFileLocks(["b", "a", "b"], async () => 42, { lockDir: dir }),
    ).resolves.toBe(42);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a symlink parent component without chmodding its target", async () => {
    const root = dirname(lockDir());
    const target = join(root, "target");
    mkdirSync(target);
    const alias = join(root, "alias-parent");
    symlinkSync(target, alias, "dir");
    await expect(withFileLock("key", async () => "bad", { lockDir: join(alias, "locks") }))
      .rejects.toThrow("must not contain user-owned symlinks");
  });

  it("does not move a successor after a stale observation", async () => {
    const dir = lockDir();
    const eventFile = join(dirname(dir), "events.jsonl");
    writeFileSync(eventFile, "");
    const name = createHash("sha256").update("race").digest("hex") + ".lock";
    writeFileSync(
      join(dir, name),
      JSON.stringify({ token: "dead", pid: 999_999_999, createdAt: 0 }),
    );

    const tsxLoader = require.resolve("tsx");
    const worker = join(here, "fixtures", "file-lock-worker.ts");
    const run = (
      label: string,
      signalMode = "normal",
      releaseFile?: string,
    ) => {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, worker, "race", eventFile, "0", dir, signalMode, label, releaseFile ?? ""],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      const exited = new Promise<void>((resolve, reject) => {
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`worker ${code}: ${stderr}`)),
        );
      });
      return { child, exited };
    };

    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!predicate()) {
        if (Date.now() >= deadline) throw new Error("barrier timed out");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    // A observes the dead owner and pauses. B wins the first reclaim. C then
    // becomes the live successor. Resuming A reproduces the stale-observation
    // interleaving that previously moved C out of the canonical path.
    const a = run("A", "pause-reclaimer");
    await waitFor(() => existsSync(`${eventFile}.observed`));
    const b = run("B");
    await b.exited;
    const releaseC = `${eventFile}.release-c`;
    const c = run("C", "normal", releaseC);
    await waitFor(() => readFileSync(eventFile, "utf8").includes('"label":"C"'));
    writeFileSync(`${eventFile}.resume-observed`, "go");
    await waitFor(() => existsSync(`${eventFile}.intent`));
    const d = run("D");
    writeFileSync(`${eventFile}.resume-intent`, "go");
    await new Promise((resolve) => setTimeout(resolve, 50));

    let events = readFileSync(eventFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const cEnter = events.findIndex((event) => event.label === "C" && event.event === "enter");
    expect(cEnter).toBeGreaterThanOrEqual(0);
    expect(events.slice(cEnter + 1).some((event) => event.event === "enter")).toBe(false);

    writeFileSync(releaseC, "go");
    await Promise.all([a.exited, c.exited, d.exited]);

    events = readFileSync(eventFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    let active = 0;
    let maxActive = 0;
    for (const event of events) {
      active += event.event === "enter" ? 1 : -1;
      maxActive = Math.max(maxActive, active);
    }
    expect(maxActive).toBe(1);
    expect(new Set(events.filter((event) => event.event === "enter").map((event) => event.label)))
      .toEqual(new Set(["A", "B", "C", "D"]));
    expect(readdirSync(dir)).toEqual([]);
  }, 15_000);

  it("removes a dead reclaim intent with a unique immutable path", async () => {
    const dir = lockDir();
    const lockName = createHash("sha256").update("dead-intent").digest("hex") + ".lock";
    writeFileSync(
      join(dir, `${lockName}.intent-999999999-dead`),
      JSON.stringify({ token: "intent", observedToken: "old", pid: 999_999_999, createdAt: 0 }),
    );
    await expect(withFileLock("dead-intent", async () => "ok", { lockDir: dir, timeoutMs: 100 }))
      .resolves.toBe("ok");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails closed on a corrupt reclaim intent", async () => {
    const dir = lockDir();
    const lockName = createHash("sha256").update("corrupt-intent").digest("hex") + ".lock";
    writeFileSync(join(dir, `${lockName}.intent-corrupt`), "{");
    await expect(withFileLock("corrupt-intent", async () => "bad", {
      lockDir: dir,
      pollMs: 5,
      timeoutMs: 30,
    })).rejects.toThrow("Timed out");
  });

  it("cleans up its owned lock on SIGINT so an immediate retry succeeds", async () => {
    const dir = lockDir();
    const eventFile = join(dirname(dir), "signal-events.jsonl");
    writeFileSync(eventFile, "");
    const tsxLoader = require.resolve("tsx");
    const worker = join(here, "fixtures", "file-lock-worker.ts");
    const child = spawn(
      process.execPath,
      ["--import", tsxLoader, worker, "signal", eventFile, "10000", dir],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.stdout.on(
        "data",
        (chunk) => String(chunk).includes("entered") && resolve(),
      );
      child.on("exit", (code) =>
        reject(new Error(`worker exited before signal: ${code}`)),
      );
    });
    child.kill("SIGINT");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect(readdirSync(dir)).toEqual([]);
    await expect(
      withFileLock("signal", async () => "ok", {
        lockDir: dir,
        timeoutMs: 100,
      }),
    ).resolves.toBe("ok");
  }, 15_000);

  it("publishes a complete record and reclaims it after a hard crash", async () => {
    const dir = lockDir();
    const eventFile = join(dirname(dir), "crash-events.jsonl");
    writeFileSync(eventFile, "");
    const tsxLoader = require.resolve("tsx");
    const worker = join(here, "fixtures", "file-lock-worker.ts");
    const child = spawn(process.execPath, ["--import", tsxLoader, worker, "crash", eventFile, "10000", dir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise<void>((resolve) => child.stdout.on("data", (chunk) => String(chunk).includes("entered") && resolve()));
    const finalLock = readdirSync(dir).find((name) => name.endsWith(".lock"));
    expect(JSON.parse(readFileSync(join(dir, finalLock!), "utf8"))).toMatchObject({
      pid: child.pid,
      token: expect.any(String),
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await expect(withFileLock("crash", async () => "ok", { lockDir: dir, timeoutMs: 200 }))
      .resolves.toBe("ok");
  }, 15_000);

  it("retains ownership when another signal handler keeps the process alive", async () => {
    const dir = lockDir();
    const eventFile = join(dirname(dir), "continue-events.jsonl");
    writeFileSync(eventFile, "");
    const tsxLoader = require.resolve("tsx");
    const worker = join(here, "fixtures", "file-lock-worker.ts");
    const child = spawn(process.execPath, ["--import", tsxLoader, worker, "continue", eventFile, "500", dir, "continue"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    while (!output.includes("entered")) await new Promise((resolve) => setTimeout(resolve, 10));
    child.kill("SIGINT");
    while (!output.includes("handled")) await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(withFileLock("continue", async () => "bad", {
      lockDir: dir, timeoutMs: 50, pollMs: 5,
    })).rejects.toThrow("Timed out");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await expect(withFileLock("continue", async () => "ok", { lockDir: dir, timeoutMs: 100 }))
      .resolves.toBe("ok");
  }, 15_000);

  it("uses the same default lock namespace from different working directories", async () => {
    const root = dirname(lockDir());
    const cwdA = join(root, "a");
    const cwdB = join(root, "b");
    mkdirSync(cwdA);
    mkdirSync(cwdB);
    const eventFile = join(root, "cwd-events.jsonl");
    writeFileSync(eventFile, "");
    const key = `cross-cwd-${process.pid}-${Date.now()}`;
    const tsxLoader = require.resolve("tsx");
    const worker = join(here, "fixtures", "file-lock-worker.ts");
    const run = (cwd: string) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ["--import", tsxLoader, worker, key, eventFile, "100"],
          {
            cwd,
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`worker ${code}: ${stderr}`)),
        );
      });
    await Promise.all([run(cwdA), run(cwdB)]);
    const events = readFileSync(eventFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual([
      "enter",
      "exit",
      "enter",
      "exit",
    ]);
  }, 15_000);
});
