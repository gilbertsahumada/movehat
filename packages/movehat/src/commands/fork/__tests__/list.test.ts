import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const storageExists = vi.fn();
const storageLoadMetadata = vi.fn();
const storageListAccounts = vi.fn();

vi.mock("../../../fork/storage.js", () => ({
  ForkStorage: class {
    exists = storageExists;
    loadMetadata = storageLoadMetadata;
    listAccounts = storageListAccounts;
  },
}));

const { default: forkListCommand } = await import("../list.js");

describe("forkListCommand", () => {
  let tmpCwd: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storageExists.mockReset();
    storageLoadMetadata.mockReset();
    storageListAccounts.mockReset();
    origCwd = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), "movehat-forklist-"));
    process.chdir(tmpCwd);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpCwd)) rmSync(tmpCwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints 'no forks found' when the forks dir doesn't exist", async () => {
    await forkListCommand();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toMatch(/No forks found/i);
    expect(storageExists).not.toHaveBeenCalled();
  });

  it("prints 'no forks found' when the forks dir is empty", async () => {
    mkdirSync(join(tmpCwd, ".movehat", "forks"), { recursive: true });
    await forkListCommand();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toMatch(/No forks found/i);
  });

  it("lists a single valid fork in a table", async () => {
    mkdirSync(join(tmpCwd, ".movehat", "forks", "testnet-fork"), { recursive: true });
    storageExists.mockReturnValue(true);
    storageLoadMetadata.mockReturnValue({
      network: "testnet",
      nodeUrl: "https://testnet.movementnetwork.xyz/v1",
      chainId: 27,
      ledgerVersion: "100",
      timestamp: "12345",
      epoch: "5",
      blockHeight: "42",
      createdAt: new Date(1700000000000).toISOString(),
    });
    storageListAccounts.mockReturnValue(["0xabc", "0xdef"]);

    await forkListCommand();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toMatch(/testnet-fork/);
    expect(printed).toMatch(/testnet/);
  });

  it("flags forks with invalid/missing metadata gracefully", async () => {
    mkdirSync(join(tmpCwd, ".movehat", "forks", "broken-fork"), { recursive: true });
    storageExists.mockReturnValue(false);

    await forkListCommand();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toMatch(/broken-fork/);
    expect(printed).toMatch(/invalid/);
  });

  it("handles metadata-load errors per-fork without aborting the list", async () => {
    mkdirSync(join(tmpCwd, ".movehat", "forks", "fork-a"), { recursive: true });
    mkdirSync(join(tmpCwd, ".movehat", "forks", "fork-b"), { recursive: true });

    // First fork: exists() throws on metadata load; second: ok.
    let call = 0;
    storageExists.mockImplementation(() => {
      call++;
      if (call === 1) throw new Error("metadata corrupt");
      return true;
    });
    storageLoadMetadata.mockReturnValue({
      network: "testnet",
      nodeUrl: "url",
      chainId: 27,
      ledgerVersion: "100",
      timestamp: "0",
      epoch: "0",
      blockHeight: "0",
      createdAt: new Date(0).toISOString(),
    });
    storageListAccounts.mockReturnValue([]);

    await forkListCommand();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toMatch(/fork-a/);
    expect(printed).toMatch(/error/);
    expect(printed).toMatch(/fork-b/);
  });

  it("skips non-directory entries in the forks dir", async () => {
    mkdirSync(join(tmpCwd, ".movehat", "forks"), { recursive: true });
    // Plant a stray file at the forks-dir level.
    writeFileSync(join(tmpCwd, ".movehat", "forks", "not-a-fork.txt"), "x");

    // No actual fork subdirs — should still hit the "0 forks" branch.
    await forkListCommand();

    const printed = logSpy.mock.calls.flat().join(" ");
    expect(printed).toMatch(/No forks found/i);
  });
});
