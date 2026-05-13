import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

import { Harness, HarnessDisposedError } from "../../harness/index.js";
import { _resetConfigCache } from "../../core/config.js";
import {
  CliExecutionError,
  ModuleAlreadyDeployedError,
  PostPublishError,
} from "../../errors.js";
import type {
  ChildProcessAdapter,
  RunInput,
  RunResult,
} from "../../utils/childProcessAdapter.js";

/**
 * Tests for `Harness.deployCodeObject` — exercises the new
 * `move deploy-object` code path with the shared profile helpers
 * lifted out of Publisher in Commit 1 of this PR.
 *
 * Uses the same fake-adapter + tmpdir-HOME pattern as
 * `__tests__/deployContract.test.ts`. No real Movement CLI calls.
 */
describe("Harness.deployCodeObject", () => {
  let tmpHome: string;
  let tmpCwd: string;
  let origHome: string | undefined;
  let origCwd: string;

  const OBJECT_ADDRESS = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const TX_HASH = "0x1111111111111111111111111111111111111111111111111111111111111111";

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "movehat-codeobj-home-"));
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-codeobj-cwd-"));

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
    writeFileSync(join(moveDir, "sources", "dummy.move"), "// empty\n");

    origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    origCwd = process.cwd();
    process.chdir(tmpCwd);
    _resetConfigCache();
  });

  afterEach(() => {
    try {
      process.chdir(origCwd);
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
      if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
      delete process.env.MH_CLI_REDEPLOY;
      _resetConfigCache();
    }
  });

  function makeAdapter(steps: {
    build: RunResult;
    deploy: RunResult;
  }): {
    adapter: ChildProcessAdapter;
    calls: RunInput[];
  } {
    const calls: RunInput[] = [];
    const adapter: ChildProcessAdapter = {
      async run(input) {
        calls.push(input);
        if (input.args[1] === "build") return steps.build;
        if (input.args[1] === "deploy-object") return steps.deploy;
        if (input.args[1] === "upgrade-object") return steps.deploy;
        throw new Error(`unexpected movement subcommand: ${input.args[1]}`);
      },
      spawn() {
        throw new Error("spawn not used in codeObject tests");
      },
    };
    return { adapter, calls };
  }

  function successStdout(): string {
    return [
      "Building package...",
      "BUILDING dummy",
      "Code was successfully deployed to object address " + OBJECT_ADDRESS,
      `transaction hash: ${TX_HASH}`,
      "{ \"Result\": { \"success\": true } }",
    ].join("\n");
  }

  it("happy path: returns CodeObjectInfo with parsed object address + txHash and writes deployment record", async () => {
    const { adapter, calls } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      const result = await harness.deployCodeObject({
        moduleName: "counter",
        adapter,
      });

      expect(result.address).toBe(OBJECT_ADDRESS);
      expect(result.txHash).toBe(TX_HASH);
      expect(result.moduleName).toBe("counter");
      expect(result.network).toBe("testnet");
      expect(result.deployer).toBe(harness.runtime.account.accountAddress.toString());
      expect(result.timestamp).toBeGreaterThan(0);

      // Deployment file written to deployments/testnet/counter.json
      const deploymentPath = join(tmpCwd, "deployments", "testnet", "counter.json");
      expect(existsSync(deploymentPath)).toBe(true);
      const saved = JSON.parse(readFileSync(deploymentPath, "utf-8"));
      expect(saved.address).toBe(OBJECT_ADDRESS);
      expect(saved.txHash).toBe(TX_HASH);

      // Verify the CLI calls: build then deploy-object
      expect(calls).toHaveLength(2);
      expect(calls[0]?.args.slice(0, 2)).toEqual(["move", "build"]);
      expect(calls[1]?.args.slice(0, 4)).toEqual([
        "move",
        "deploy-object",
        "--address-name",
        "counter",
      ]);
      expect(calls[1]?.args).toContain("--assume-yes");
    } finally {
      await harness.cleanup();
    }
  });

  it("idempotency: re-deploying the same module throws ModuleAlreadyDeployedError and does NOT invoke the CLI", async () => {
    // First, plant an existing deployment record by running a successful deploy.
    const first = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });

    const harness1 = await Harness.createLive("testnet");
    await harness1.deployCodeObject({ moduleName: "counter", adapter: first.adapter });
    await harness1.cleanup();

    // Second deploy with same moduleName + same network — must reject.
    const second = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const harness2 = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness2.deployCodeObject({ moduleName: "counter", adapter: second.adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ModuleAlreadyDeployedError);
      const err = caught as ModuleAlreadyDeployedError;
      expect(err.moduleName).toBe("counter");
      expect(err.network).toBe("testnet");
      // CLI must not have been invoked on the second attempt.
      expect(second.calls).toHaveLength(0);
    } finally {
      await harness2.cleanup();
    }
  });

  it("MH_CLI_REDEPLOY=true bypasses the idempotency check", async () => {
    // Plant the first deployment.
    const first = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const harness1 = await Harness.createLive("testnet");
    await harness1.deployCodeObject({ moduleName: "counter", adapter: first.adapter });
    await harness1.cleanup();

    // Redeploy with the env flag — should call the CLI again.
    process.env.MH_CLI_REDEPLOY = "true";
    const second = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 0, stdout: successStdout(), stderr: "" },
    });
    const harness2 = await Harness.createLive("testnet");
    try {
      const result = await harness2.deployCodeObject({
        moduleName: "counter",
        adapter: second.adapter,
      });
      expect(result.address).toBe(OBJECT_ADDRESS);
      // The CLI WAS invoked the second time.
      expect(second.calls.length).toBeGreaterThan(0);
    } finally {
      await harness2.cleanup();
    }
  });

  it("build failure rethrows CliExecutionError and never writes a profile to ~/.aptos/config.yaml", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 1, stdout: "", stderr: "compilation error: undefined identifier" },
      deploy: { exitCode: 0, stdout: "", stderr: "" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.deployCodeObject({ moduleName: "counter", adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CliExecutionError);
      // The profile-write happens AFTER build, so build failure should
      // never have touched ~/.aptos/config.yaml.
      expect(existsSync(join(tmpHome, ".aptos", "config.yaml"))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("deploy-object failure rethrows AND the temp profile is removed from ~/.aptos/config.yaml in finally", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: { exitCode: 1, stdout: "", stderr: "transaction failed: insufficient funds" },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.deployCodeObject({ moduleName: "counter", adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CliExecutionError);
      // The finally block must have cleaned the temp profile — file
      // unlinked because we wrote a fresh profile-only yaml.
      expect(existsSync(join(tmpHome, ".aptos", "config.yaml"))).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("output without a parseable object address throws a clear error (not CliExecutionError)", async () => {
    const { adapter } = makeAdapter({
      build: { exitCode: 0, stdout: "build ok", stderr: "" },
      deploy: {
        exitCode: 0,
        stdout: "deployed successfully (but no object address mentioned)",
        stderr: "",
      },
    });

    const harness = await Harness.createLive("testnet");
    try {
      let caught: unknown;
      try {
        await harness.deployCodeObject({ moduleName: "counter", adapter });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      // Not a CliExecutionError — the CLI succeeded, our parser failed.
      expect(caught).not.toBeInstanceOf(CliExecutionError);
      expect((caught as Error).message).toMatch(/Could not parse object address/);
    } finally {
      await harness.cleanup();
    }
  });

  it("fork-mode harness throws synchronously before any CLI call (covered separately for createLocal/createFork in M4 integration suite)", async () => {
    // This case can't be tested with a real createFork (it spawns a fork
    // server). Instead, prove that the disposed-instance path also fires
    // synchronously: a poisoned harness throws HarnessDisposedError on
    // property access, BEFORE any CLI call is attempted. The fork-mode
    // guard uses the same synchronous-throw pattern.
    const harness = await Harness.createLive("testnet");
    await harness.cleanup();
    expect(() => harness.deployCodeObject({ moduleName: "x" })).toThrow(
      HarnessDisposedError
    );
  });
});
