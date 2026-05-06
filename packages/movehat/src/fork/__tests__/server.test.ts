import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AddressInfo } from "net";
import { ForkServer } from "../server.js";

/**
 * Helper to set up a minimal fork directory so ForkServer.start() succeeds.
 */
function makeForkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "movehat-fork-server-"));
  mkdirSync(join(dir, "resources"), { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      network: "test",
      nodeUrl: "http://example.invalid/v1",
      chainId: 0,
      ledgerVersion: "0",
      timestamp: "0",
      epoch: "0",
      blockHeight: "0",
      createdAt: new Date().toISOString(),
    }),
  );
  writeFileSync(join(dir, "accounts.json"), "{}");
  return dir;
}

describe("ForkServer", () => {
  let forkDir: string;
  let server: ForkServer | null = null;

  beforeEach(() => {
    forkDir = makeForkDir();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(forkDir, { recursive: true, force: true });
  });

  it("binds to 127.0.0.1 by default", async () => {
    // Port 0 lets the OS pick a free port.
    server = new ForkServer(forkDir, 0);
    await server.start();

    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const addr = internal.address();
    expect(addr.address).toBe("127.0.0.1");
  });

  it("respects a custom host argument (::1)", async () => {
    server = new ForkServer(forkDir, 0, "::1");
    await server.start();

    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const addr = internal.address();
    expect(addr.address).toBe("::1");
  });
});
