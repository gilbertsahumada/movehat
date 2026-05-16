import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yaml from "js-yaml";

import {
  addProfile,
  removeProfile,
  withYamlLock,
} from "../movementProfile.js";

/**
 * F5 — `withYamlLock` provides in-process serialization for the
 * read-modify-write cycle on `~/.aptos/config.yaml`. The lock is
 * intentionally process-local (see {@link withYamlLock} docstring);
 * cross-process contention requires an external lockfile and is
 * tracked as a separate hardening item — that test is `it.skip` here
 * so the contract gap is visible in the suite.
 */

describe("F5 — movementProfile yamlLock", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-yamllock-"));
    configPath = join(tmpDir, "config.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("withYamlLock serializes concurrent in-process callers (read-modify-write does not lose writes)", async () => {
    // 20 concurrent addProfile calls. Without the lock, the read-
    // modify-write cycle would race and the final file would carry
    // fewer than 20 profiles.
    const data = (n: number) => ({
      private_key: `0x${n.toString(16).padStart(64, "0")}`,
      public_key: `0xpub-${n}`,
      account: `0xacc-${n}`,
      rest_url: "http://localhost:8080/v1",
    });

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withYamlLock(() => addProfile(configPath, `p${i}`, data(i)))
      )
    );

    const raw = readFileSync(configPath, "utf-8");
    const parsed = yaml.load(raw) as { profiles?: Record<string, unknown> };
    expect(parsed.profiles).toBeDefined();
    expect(Object.keys(parsed.profiles!).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `p${i}`).sort()
    );
  });

  it("removeProfile is idempotent and atomic under the lock", async () => {
    const data = {
      private_key: "0x" + "a".repeat(64),
      public_key: "0xpub",
      account: "0xacc",
      rest_url: "http://localhost:8080/v1",
    };
    await withYamlLock(() => addProfile(configPath, "x", data));
    expect(readFileSync(configPath, "utf-8")).toContain("x:");

    // Run concurrent removes — second should be a no-op.
    await Promise.all([
      withYamlLock(() => removeProfile(configPath, "x")),
      withYamlLock(() => removeProfile(configPath, "x")),
    ]);
    // File is unlinked when its last profile is removed.
    expect(() => readFileSync(configPath, "utf-8")).toThrow();
  });

  it.skip("cross-process contention loses profiles (documented F5 gap; needs external lockfile)", async () => {
    // Reproduction: spawn two Node child processes that each call
    // addProfile against the same configPath. Without an OS-level
    // lock (e.g. proper-lockfile or O_EXCL guard), one profile is
    // lost. Skipped here because the race is timing-sensitive — flaky
    // on CI. The contract gap is recorded in the docstring of
    // `withYamlLock` in movementProfile.ts and tracked as a follow-up
    // sub-issue for cross-process hardening.
    writeFileSync(configPath, "");
    expect(true).toBe(true);
  });
});
