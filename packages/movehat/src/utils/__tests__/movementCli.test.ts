import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { resolveMovementBinary, sanitizeMovementEnv } from "../movementCli.js";

function makeExecutable(pathname: string): void {
  writeFileSync(pathname, "#!/bin/sh\nexit 0\n");
  chmodSync(pathname, 0o755);
}

describe("resolveMovementBinary", () => {
  let tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    tmpRoots = [];
  });

  it("resolves a trusted movement executable to an absolute path", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "movehat-project-"));
    const binDir = mkdtempSync(join(tmpdir(), "movehat-bin-"));
    tmpRoots.push(projectRoot, binDir);
    const movement = join(binDir, "movement");
    makeExecutable(movement);

    expect(
      resolveMovementBinary({
        projectRoot,
        env: { PATH: binDir },
      })
    ).toBe(realpathSync(movement));
  });

  it("rejects a movement executable resolved from the project tree", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "movehat-project-"));
    tmpRoots.push(projectRoot);
    const binDir = join(projectRoot, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    makeExecutable(join(binDir, "movement"));

    expect(() =>
      resolveMovementBinary({
        projectRoot,
        env: { PATH: binDir },
      })
    ).toThrow(/project-controlled path|node_modules/);
  });

  it("requires MOVEHAT_MOVEMENT_BIN to be absolute", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "movehat-project-"));
    tmpRoots.push(projectRoot);

    expect(() =>
      resolveMovementBinary({
        projectRoot,
        env: {
          PATH: process.env.PATH ?? "",
          MOVEHAT_MOVEMENT_BIN: "relative/movement",
        },
      })
    ).toThrow(/absolute path/);
  });

  it("prefers an absolute MOVEHAT_MOVEMENT_BIN override", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "movehat-project-"));
    const overrideDir = mkdtempSync(join(tmpdir(), "movehat-override-"));
    const pathDir = mkdtempSync(join(tmpdir(), "movehat-path-"));
    tmpRoots.push(projectRoot, overrideDir, pathDir);
    const override = join(overrideDir, "movement");
    makeExecutable(override);
    makeExecutable(join(pathDir, "movement"));

    expect(
      resolveMovementBinary({
        projectRoot,
        env: {
          PATH: [pathDir, process.env.PATH ?? ""].join(delimiter),
          MOVEHAT_MOVEMENT_BIN: override,
        },
      })
    ).toBe(realpathSync(override));
  });
});

describe("sanitizeMovementEnv", () => {
  it("keeps operational variables and drops secret-shaped variables", () => {
    const env = sanitizeMovementEnv({
      PATH: "/bin",
      HOME: "/home/test",
      MOVEMENT_RPC_URL: "https://rpc.example",
      PRIVATE_KEY: "0x" + "a".repeat(64),
      GITHUB_TOKEN: "ghp_secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      NORMAL_VAR: "drop-me",
    });

    expect(env.PATH).toBe("/bin");
    expect(env.HOME).toBe("/home/test");
    expect(env.MOVEMENT_RPC_URL).toBe("https://rpc.example");
    expect(env.PRIVATE_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.NORMAL_VAR).toBeUndefined();
  });
});
