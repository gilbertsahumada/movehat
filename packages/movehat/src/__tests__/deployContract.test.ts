import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliExecutionError } from "../errors.js";
import { initRuntime } from "../runtime.js";
import type { ChildProcessAdapter, RunInput, RunResult } from "../utils/childProcessAdapter.js";

/**
 * Guards against the bug-#43 leak path: when `movement move publish`
 * echoes `ed25519-priv-…` material in stdout/stderr, neither the
 * thrown error nor anything reaching `console.error` may carry the
 * raw key. The redaction is structurally guaranteed by runCli today
 * — these tests make the guarantee *directly* asserted so a future
 * PR adding a non-runCli code path can't silently re-leak.
 */
describe("runtime.deployContract — secret redaction", () => {
  let tmpHome: string;
  let tmpCwd: string;
  let origHome: string | undefined;
  let origCwd: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "movehat-test-home-"));
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-test-cwd-"));

    // Minimal movehat.config.js — testnet with no `accounts` means the
    // auto-generated deterministic test key is used (config.ts:147-155).
    writeFileSync(
      join(tmpCwd, "movehat.config.js"),
      `export default {
  defaultNetwork: "testnet",
  networks: {
    testnet: {
      url: "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet"
    }
  }
};
`
    );

    // Minimal Move package layout. `extractNamedAddresses` reads
    // <moveDir>/sources/*.move; the empty file produces an empty Set.
    const moveDir = join(tmpCwd, "move");
    mkdirSync(join(moveDir, "sources"), { recursive: true });
    writeFileSync(
      join(moveDir, "Move.toml"),
      `[package]
name = "dummy"
version = "0.0.1"

[addresses]
`
    );
    writeFileSync(join(moveDir, "sources", "dummy.move"), "// intentionally empty\n");

    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    origCwd = process.cwd();
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    try {
      process.chdir(origCwd);
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
      if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    }
  });

  function makeAdapter(steps: { build: RunResult; publish: RunResult }): {
    adapter: ChildProcessAdapter;
    calls: RunInput[];
  } {
    const calls: RunInput[] = [];
    const adapter: ChildProcessAdapter = {
      async run(input) {
        calls.push(input);
        // The args layout is `["move", "build" | "publish", ...rest]`.
        if (input.args[1] === "build") return steps.build;
        if (input.args[1] === "publish") return steps.publish;
        throw new Error(`unexpected movement subcommand: ${input.args[1]}`);
      },
      spawn() {
        throw new Error("spawn not used in deployContract tests");
      },
    };
    return { adapter, calls };
  }

  it("leak path #2 — rethrown error has redacted stderr (no raw ed25519-priv-)", async () => {
    const rawKey = "ed25519-priv-0x" + "a".repeat(64);
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      publish: { exitCode: 1, stdout: "", stderr: `Movement publish failed: ${rawKey}` },
    });

    const runtime = await initRuntime();

    let captured: unknown;
    try {
      await runtime.deployContract("mymodule", { adapter });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(CliExecutionError);
    const err = captured as CliExecutionError;
    expect(err.stderr).toContain("***REDACTED***");
    expect(err.stderr).not.toContain("ed25519-priv-");
    expect(err.stderr).not.toContain(rawKey);

    // Bonus: deployContract's finally block must have restored / removed the
    // movement config file. If a future refactor breaks the finally, this
    // assertion fires before any real damage.
    expect(existsSync(join(tmpHome, ".aptos", "config.yaml"))).toBe(false);
  });

  it("leak path #1 — console.error on a noisy-but-successful publish never sees raw key", async () => {
    const rawKey = "ed25519-priv-0x" + "a".repeat(64);
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      // Publish succeeds (exitCode 0) but emits a stderr line containing the key.
      publish: {
        exitCode: 0,
        stdout: "Transaction hash: 0x" + "b".repeat(64),
        stderr: `warning: ${rawKey}`,
      },
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const runtime = await initRuntime();
      await runtime.deployContract("mymodule", { adapter });

      const allErr = errSpy.mock.calls.flat().join("\n");
      const allLog = logSpy.mock.calls.flat().join("\n");
      expect(allErr).not.toContain("ed25519-priv-");
      expect(allErr).not.toContain(rawKey);
      expect(allLog).not.toContain("ed25519-priv-");
      expect(allLog).not.toContain(rawKey);
    } finally {
      errSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
