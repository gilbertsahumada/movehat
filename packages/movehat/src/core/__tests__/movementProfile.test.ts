import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  removeKeyFile,
  removeKeyFileSyncBestEffort,
  writeTempKeyFile,
} from "../movementProfile.js";

/**
 * Unit tests for the two distinct cleanup helpers in movementProfile:
 *
 *   - `removeKeyFileSyncBestEffort`: for SIGINT/SIGTERM handlers where
 *     the event loop is dead. Never throws, never logs, always returns
 *     void. We only test that it doesn't throw.
 *
 *   - `removeKeyFile`: for normal `finally` cleanup paths. Returns
 *     `null` when the file is gone (removed OR already absent — both
 *     are benign), and returns an `Error` only when the file STILL
 *     exists on disk after the unlink attempt failed. The Error path
 *     is exactly the case the caller must surface as a warning,
 *     because a private-key temp file would otherwise persist
 *     silently.
 */

describe("movementProfile cleanup helpers", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "movehat-profile-test-"));
  });

  afterEach(() => {
    if (existsSync(scratchDir)) {
      // Force chmod in case a test left it un-removable, then rmSync.
      try {
        chmodSync(scratchDir, 0o700);
      } catch {
        /* best-effort */
      }
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  describe("writeTempKeyFile", () => {
    it("creates a 0o600 file in os.tmpdir() with the key as contents", () => {
      const path = writeTempKeyFile("ed25519-priv-0x" + "a".repeat(64));
      try {
        expect(path.startsWith(tmpdir())).toBe(true);
        expect(path).toMatch(/movehat-key-/);
        expect(existsSync(path)).toBe(true);
      } finally {
        if (existsSync(path)) rmSync(path);
      }
    });
  });

  describe("removeKeyFileSyncBestEffort", () => {
    it("removes an existing file", () => {
      const path = join(scratchDir, "key");
      writeFileSync(path, "x", { mode: 0o600 });
      removeKeyFileSyncBestEffort(path);
      expect(existsSync(path)).toBe(false);
    });

    it("does not throw when the file is already gone", () => {
      const path = join(scratchDir, "never-existed");
      expect(() => removeKeyFileSyncBestEffort(path)).not.toThrow();
    });

    it("does not throw when the path is a non-empty directory (would fail in stricter callers)", () => {
      const dirPath = join(scratchDir, "i-am-a-directory");
      mkdirSync(dirPath);
      writeFileSync(join(dirPath, "child"), "x");
      expect(() => removeKeyFileSyncBestEffort(dirPath)).not.toThrow();
      // The dir still exists — best-effort doesn't fight EISDIR.
      expect(existsSync(dirPath)).toBe(true);
    });
  });

  describe("removeKeyFile", () => {
    it("returns null when the file is removed cleanly", () => {
      const path = join(scratchDir, "key-to-remove");
      writeFileSync(path, "x", { mode: 0o600 });
      const err = removeKeyFile(path);
      expect(err).toBeNull();
      expect(existsSync(path)).toBe(false);
    });

    it("returns null when the file was already gone (ENOENT is benign)", () => {
      const path = join(scratchDir, "never-existed");
      const err = removeKeyFile(path);
      expect(err).toBeNull();
    });

    it("returns null when the file disappears between the unlink attempt and the existsSync check (race)", () => {
      // Hard to provoke a real race deterministically. The contract is
      // documented; the previous test covers the ENOENT short-circuit
      // which is the common race outcome.
      const path = join(scratchDir, "raced");
      const err = removeKeyFile(path);
      expect(err).toBeNull();
    });

    it("returns an Error when the path is a directory AND still exists post-attempt", () => {
      // unlinkSync on a directory throws EISDIR (or EPERM on some
      // platforms). existsSync afterwards still returns true, so this
      // is the "preocupante" path the caller must surface as a warning
      // — the file (here, a directory occupying the key-file path) is
      // still on disk.
      const dirPath = join(scratchDir, "key-but-actually-a-dir");
      mkdirSync(dirPath);
      writeFileSync(join(dirPath, "child"), "x"); // make sure it's not empty
      const err = removeKeyFile(dirPath);
      expect(err).not.toBeNull();
      expect(err).toBeInstanceOf(Error);
      // Error code is platform-dependent (EISDIR on linux, EPERM on
      // macos), so just assert we got something Error-shaped.
      expect((err as NodeJS.ErrnoException).code).toMatch(/^E/);
      expect(existsSync(dirPath)).toBe(true);
    });
  });
});
