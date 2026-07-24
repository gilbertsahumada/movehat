import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deploymentLockKeys } from "../deploymentLockKeys.js";
import { withFileLocks } from "../fileLock.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; projectA: string; projectB: string; packageA: string; packageB: string; lockDir: string } {
  const root = mkdtempSync(join(tmpdir(), "movehat-deployment-lock-"));
  roots.push(root);
  const projectA = join(root, "project-a");
  const projectB = join(root, "project-b");
  const packageA = join(projectA, "move");
  const packageB = join(projectB, "move");
  const lockDir = join(root, "locks");
  for (const dir of [packageA, packageB, lockDir]) mkdirSync(dir, { recursive: true });
  return { root, projectA, projectB, packageA, packageB, lockDir };
}

describe("deploymentLockKeys", () => {
  it("does not serialize unrelated projects with the same chain and module", async () => {
    const { projectA, projectB, packageA, packageB, lockDir } = fixture();
    const a = deploymentLockKeys({ packageDir: packageA, projectDir: projectA, chainIdentity: "27", moduleName: "counter" });
    const b = deploymentLockKeys({ packageDir: packageB, projectDir: projectB, chainIdentity: "27", moduleName: "counter" });
    let releaseA!: () => void;
    let markAStarted!: () => void;
    const aStarted = new Promise<void>((resolve) => { markAStarted = resolve; });
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const first = withFileLocks(a.keys, async () => { markAStarted(); await gateA; }, { lockDir, pollMs: 5 });
    await aStarted;
    let bEntered = false;
    const second = withFileLocks(b.keys, async () => { bEntered = true; }, { lockDir, pollMs: 5 });
    const deadline = Date.now() + 500;
    while (!bEntered && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bEntered).toBe(true);
    releaseA();
    await Promise.all([first, second]);
  });

  it("serializes the same deployment identity across different packages in one project", async () => {
    const { root, projectA, packageA, lockDir } = fixture();
    const packageB = join(root, "other-package");
    mkdirSync(packageB);
    const a = deploymentLockKeys({ packageDir: packageA, projectDir: projectA, chainIdentity: "27", moduleName: "counter" });
    const b = deploymentLockKeys({ packageDir: packageB, projectDir: projectA, chainIdentity: "27", moduleName: "counter" });
    let releaseA!: () => void;
    let markAStarted!: () => void;
    const aStarted = new Promise<void>((resolve) => { markAStarted = resolve; });
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const first = withFileLocks(a.keys, async () => { markAStarted(); await gateA; }, { lockDir, pollMs: 5 });
    await aStarted;
    let bEntered = false;
    const second = withFileLocks(b.keys, async () => { bEntered = true; }, { lockDir, pollMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bEntered).toBe(false);
    releaseA();
    await Promise.all([first, second]);
    expect(bEntered).toBe(true);
  });

  it("retains package-level serialization across different project scopes", () => {
    const { projectA, projectB, packageA } = fixture();
    const a = deploymentLockKeys({ packageDir: packageA, projectDir: projectA, chainIdentity: "27", moduleName: "a" });
    const b = deploymentLockKeys({ packageDir: packageA, projectDir: projectB, chainIdentity: "27", moduleName: "b" });
    expect(a.keys[0]).toBe(b.keys[0]);
    expect(a.keys[1]).not.toBe(b.keys[1]);
  });
});
