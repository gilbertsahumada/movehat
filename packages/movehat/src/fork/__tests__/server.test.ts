import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AddressInfo } from "net";

// Stub the upstream API client so view-proxy tests stay offline.
// Same hoisting + module-scoped fakes pattern used in manager.test.ts.
const fakeApi = {
  getLedgerInfo: vi.fn(),
  getAccount: vi.fn(),
  getAccountResource: vi.fn(),
  getAccountResources: vi.fn(),
  view: vi.fn(),
};

vi.mock("../api.js", () => ({
  MovementApiClient: class {
    constructor(_nodeUrl: string, _apiKey?: string) {}
    getLedgerInfo = fakeApi.getLedgerInfo;
    getAccount = fakeApi.getAccount;
    getAccountResource = fakeApi.getAccountResource;
    getAccountResources = fakeApi.getAccountResources;
    view = fakeApi.view;
  },
}));

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

describe("ForkServer — POST /v1/view proxy", () => {
  let forkDir: string;
  let server: ForkServer | null = null;

  beforeEach(() => {
    forkDir = makeForkDir();
    fakeApi.view.mockReset();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(forkDir, { recursive: true, force: true });
  });

  async function postView(body: string): Promise<{ status: number; body: any }> {
    server = new ForkServer(forkDir, 0);
    await server.start();
    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const port = internal.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return { status: res.status, body: await res.json() };
  }

  it("forwards a view-fn payload to upstream and returns the result", async () => {
    fakeApi.view.mockResolvedValueOnce(["100"]);

    const { status, body } = await postView(
      JSON.stringify({ function: "0x1::coin::supply", type_arguments: [], arguments: [] }),
    );

    expect(status).toBe(200);
    expect(body).toEqual(["100"]);
    expect(fakeApi.view).toHaveBeenCalledTimes(1);
    // The proxy forwards whitelisted headers (Accept, X-Aptos-Client)
    // through to upstream. `fetch()` in this test doesn't set
    // X-Aptos-Client, but undici sets a default `Accept: */*` we round-
    // trip transparently.
    const firstCall = fakeApi.view.mock.calls[0]!;
    const [forwardedPayload, forwardedHeaders] = firstCall;
    expect(forwardedPayload).toEqual({
      function: "0x1::coin::supply",
      type_arguments: [],
      arguments: [],
    });
    expect(forwardedHeaders).not.toHaveProperty("X-Aptos-Client");
  });

  it("rejects malformed JSON with 400 invalid_body", async () => {
    const { status, body } = await postView("not-json{");

    expect(status).toBe(400);
    expect(body.error_code).toBe("invalid_body");
    expect(fakeApi.view).not.toHaveBeenCalled();
  });

  it("returns 502 upstream_error when the upstream RPC fails", async () => {
    fakeApi.view.mockRejectedValueOnce(new Error("connection refused"));

    const { status, body } = await postView(
      JSON.stringify({ function: "0x1::coin::supply", type_arguments: [], arguments: [] }),
    );

    expect(status).toBe(502);
    expect(body.error_code).toBe("upstream_error");
    expect(body.message).toContain("connection refused");
  });

  it("forwards Accept and X-Aptos-Client headers to upstream", async () => {
    fakeApi.view.mockResolvedValueOnce(["forwarded"]);

    server = new ForkServer(forkDir, 0);
    await server.start();
    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const port = internal.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/view`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/x-bcs",
        "X-Aptos-Client": "my-test-client/1.0",
      },
      body: JSON.stringify({ function: "0x1::coin::supply" }),
    });

    expect(res.status).toBe(200);
    expect(fakeApi.view).toHaveBeenCalledWith(
      { function: "0x1::coin::supply" },
      {
        Accept: "application/x-bcs",
        "X-Aptos-Client": "my-test-client/1.0",
      },
    );
  });
});
