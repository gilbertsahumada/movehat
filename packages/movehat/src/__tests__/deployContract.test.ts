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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import * as yaml from "js-yaml";
import { CliExecutionError } from "../errors.js";
import { initRuntime } from "../runtime.js";
import { Publisher } from "../core/Publisher.js";
import type { ChildProcessAdapter, RunInput, RunResult } from "../utils/childProcessAdapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

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
    const [build, publish] = calls;
    if (!build || !publish) throw new Error("expected 2 captured calls");
    expect(build.command).toBe("movement");
    expect(build.args.slice(0, 2)).toEqual(["move", "build"]);
    expect(publish.args.slice(0, 2)).toEqual(["move", "publish"]);
    for (const arg of [...build.args, ...publish.args]) {
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

  it("SIGINT mid-deploy cleans the profile from ~/.aptos/config.yaml (#36)", async () => {
    // Pre-fix #36: between the yaml write (private key persisted) and the
    // finally block, a SIGINT would skip cleanup and leave the user's
    // private key sitting in ~/.aptos/config.yaml at mode 0o600.
    // Post-fix: a sync signal handler runs synchronously before exit,
    // removing the deploy's unique profile from the yaml.
    //
    // This test spawns a child process running a harness that drives
    // Publisher.deploy() with a 3-second-delayed publish, then sends
    // SIGINT mid-flight. Vitest's own process is unaffected because
    // the SIGINT goes to the child.

    // Seed an unrelated user profile that MUST survive.
    const aptosDir = join(tmpHome, ".aptos");
    mkdirSync(aptosDir, { recursive: true });
    const configPath = join(aptosDir, "config.yaml");
    writeFileSync(
      configPath,
      yaml.dump({
        profiles: {
          user_main: {
            private_key: "0x" + "a".repeat(64),
            public_key: "0x" + "b".repeat(64),
            account: "0x" + "c".repeat(64),
            rest_url: "https://example.invalid/v1",
          },
        },
      }),
      { mode: 0o600 }
    );

    const harnessPath = join(__dirname, "fixtures", "sigint-deploy-harness.ts");
    // Resolve tsx's CLI binary by absolute path — the test's tmp cwd has
    // no node_modules, so a bare `tsx` import would fail to resolve.
    // `require.resolve("tsx")` returns the package's main (dist/loader.mjs);
    // the binary is two levels up from there, in `<root>/dist/cli.mjs`
    // (same trick `commands/run.ts:49-53` uses).
    const tsxMain = require.resolve("tsx");
    const tsxCliPath = join(dirname(dirname(tsxMain)), "dist", "cli.mjs");
    const child = spawn(
      process.execPath,
      [tsxCliPath, harnessPath],
      {
        env: { ...process.env, HOME: tmpHome },
        cwd: tmpCwd,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    // Wait for the harness to announce its unique profile name via stdout
    // (it writes a JSON line `{"profile":"movehat-deploy-XXXX"}` just
    // before entering the slow publish step).
    let announced: string | undefined;
    let stdoutBuf = "";
    let stderrBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      for (const line of stdoutBuf.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (typeof parsed.profile === "string") announced = parsed.profile;
        } catch {
          /* not a JSON line we care about */
        }
      }
    });
    child.stderr?.on("data", (c: Buffer) => (stderrBuf += c.toString()));

    // Poll until the harness has announced OR 8s timeout (the import +
    // SDK initialization can take a few seconds in CI/cold-start).
    const start = Date.now();
    while (!announced && Date.now() - start < 8000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!announced) {
      child.kill("SIGKILL");
      throw new Error(
        `harness never announced profile in 8s.\n` +
          `stdout so far:\n${stdoutBuf}\n---\nstderr so far:\n${stderrBuf}`
      );
    }

    expect(announced).toMatch(/^movehat-deploy-/);

    // Deliver SIGINT mid-publish and wait for the harness to exit.
    child.kill("SIGINT");
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
    });
    expect(exitCode).toBe(130);

    // The yaml on disk contains the user's original profile and NO
    // movehat-deploy-* leftovers.
    expect(existsSync(configPath)).toBe(true);
    const finalYaml: any = yaml.load(readFileSync(configPath, "utf8"));
    expect(finalYaml.profiles).toBeDefined();
    expect(Object.keys(finalYaml.profiles).sort()).toEqual(["user_main"]);
    expect(finalYaml.profiles.user_main.private_key).toBe("0x" + "a".repeat(64));
  }, 15000);

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
