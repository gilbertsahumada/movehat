import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { CliExecutionError } from "../errors.js";
import { initRuntime } from "../runtime.js";
import { Publisher } from "../core/Publisher.js";
import { AccountManager } from "../core/AccountManager.js";
import { resolveNetworkConfig } from "../core/config.js";
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
    const { adapter, calls } = makeAdapter({
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

    // Pin the call shape: build then publish, args reach the adapter un-quoted.
    // A previous regression (shell-escape mismatch fixed in 511fd95) survived
    // unit tests because no assertion checked what landed in `args`.
    expect(calls).toHaveLength(2);
    expect(calls[0].command).toBe("movement");
    expect(calls[0].args.slice(0, 2)).toEqual(["move", "build"]);
    expect(calls[1].args.slice(0, 2)).toEqual(["move", "publish"]);
    for (const arg of [...calls[0].args, ...calls[1].args]) {
      expect(arg.startsWith("'")).toBe(false);
      expect(arg.endsWith("'")).toBe(false);
    }

    // Bonus: deployContract's finally block must have restored / removed the
    // movement config file. If a future refactor breaks the finally, this
    // assertion fires before any real damage.
    expect(existsSync(join(tmpHome, ".aptos", "config.yaml"))).toBe(false);
  });

  it("two concurrent deploys do not corrupt ~/.aptos/config.yaml (#37)", async () => {
    // Pre-fix #37: both deploys overwrote ~/.aptos/config.yaml with the
    // SAME profile name ("default" by default), then both restored
    // independently. The second deploy's restore would overwrite the
    // first's profile mid-publish → potential cross-contamination of
    // private keys / accounts. Post-fix: each deploy uses a unique
    // movehat-deploy-<uuid> profile name and only deletes its own key
    // on cleanup. The user's other profiles never get touched.
    //
    // The mutex is what makes this safe — without it, the
    // read-modify-write cycles would race and silently drop a profile.

    // Seed the yaml with an unrelated user profile that MUST survive.
    const aptosDir = join(tmpHome, ".aptos");
    mkdirSync(aptosDir, { recursive: true });
    const preExisting = {
      profiles: {
        user_main: {
          private_key: "0x" + "1".repeat(64),
          public_key: "0x" + "2".repeat(64),
          account: "0x" + "3".repeat(64),
          rest_url: "https://example.invalid/v1",
        },
      },
    };
    const configPath = join(aptosDir, "config.yaml");
    writeFileSync(configPath, yaml.dump(preExisting), { mode: 0o600 });

    // Set up two Publisher instances with fake adapters that record their
    // own --profile argument and inject a small delay on publish so the
    // critical sections overlap.
    function makeDelayedAdapter(label: string): {
      adapter: ChildProcessAdapter;
      captured: { publishCall?: RunInput };
    } {
      const captured: { publishCall?: RunInput } = {};
      const adapter: ChildProcessAdapter = {
        async run(input) {
          if (input.args[1] === "build") {
            return { exitCode: 0, stdout: `built ${label}`, stderr: "" };
          }
          if (input.args[1] === "publish") {
            captured.publishCall = input;
            // Hold the lock-protected critical section open long enough
            // for the other deploy's addProfile to compete.
            await new Promise((r) => setTimeout(r, 30));
            return {
              exitCode: 0,
              stdout: `Transaction hash: 0x${"d".repeat(64)}`,
              stderr: "",
            };
          }
          throw new Error(`unexpected: ${input.args[1]}`);
        },
        spawn() {
          throw new Error("spawn not used");
        },
      };
      return { adapter, captured };
    }

    const a = makeDelayedAdapter("A");
    const b = makeDelayedAdapter("B");

    // Build a minimal config + account once via initRuntime, then call
    // Publisher directly (bypasses the loadDeployment cache that would
    // throw on the second deploy if both used moduleName "test").
    const runtime = await initRuntime();
    const { config, account } = runtime;

    await Promise.all([
      new Publisher({ adapter: a.adapter }).deploy({
        moduleName: "concurrent_a",
        config,
        account,
        packageDir: join(tmpCwd, "move"),
      }),
      new Publisher({ adapter: b.adapter }).deploy({
        moduleName: "concurrent_b",
        config,
        account,
        packageDir: join(tmpCwd, "move"),
      }),
    ]);

    // Both publish calls captured distinct --profile args.
    const argsA = a.captured.publishCall!.args;
    const argsB = b.captured.publishCall!.args;
    const profileArgA = argsA[argsA.indexOf("--profile") + 1];
    const profileArgB = argsB[argsB.indexOf("--profile") + 1];
    expect(profileArgA).toMatch(/^movehat-deploy-/);
    expect(profileArgB).toMatch(/^movehat-deploy-/);
    expect(profileArgA).not.toBe(profileArgB);

    // After both deploys finish, ~/.aptos/config.yaml contains the
    // user's original profile and zero movehat-deploy-* profiles.
    const finalYaml: any = yaml.load(readFileSync(configPath, "utf8"));
    expect(finalYaml.profiles).toBeDefined();
    expect(Object.keys(finalYaml.profiles)).toEqual(["user_main"]);
    expect(finalYaml.profiles.user_main.private_key).toBe(
      preExisting.profiles.user_main.private_key
    );
  });

  it("does not mutate Move.toml during deploy (#38)", async () => {
    // Pre-fix #38: deployContract overwrote every entry under [addresses]
    // with the deployer address, then relied on `finally` to restore.
    // Post-fix: Move.toml is never touched — `--named-addresses` carries
    // the overrides on the CLI line for both build and publish.
    const moveTomlPath = join(tmpCwd, "move", "Move.toml");
    const moveTomlContent = `[package]
name = "dummy"
version = "0.0.1"

[addresses]
counter = "0x42"
greeting = "0xcafe"
`;
    writeFileSync(moveTomlPath, moveTomlContent);

    // Move source that references "counter" so extractNamedAddresses picks
    // it up — otherwise the --named-addresses arg is empty and the test
    // is uninteresting.
    writeFileSync(
      join(tmpCwd, "move", "sources", "dummy.move"),
      "module counter::dummy { }\n"
    );

    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      publish: {
        exitCode: 0,
        stdout: "Transaction hash: 0x" + "c".repeat(64),
        stderr: "",
      },
    });

    const runtime = await initRuntime();
    await runtime.deployContract("counter", { adapter });

    const after = readFileSync(moveTomlPath, "utf8");
    expect(after).toBe(moveTomlContent);
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
