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

  async function startAndFetch(path: string, init?: RequestInit): Promise<Response> {
    server = new ForkServer(forkDir, 0);
    await server.start();
    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const port = internal.address().port;

    return fetch(`http://127.0.0.1:${port}${path}`, init);
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

  it("redacts upstream view errors before logging or returning them", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rawSecret = "0x" + "a".repeat(64);
    fakeApi.view.mockRejectedValueOnce(new Error(`private_key=${rawSecret}`));

    const { status, body } = await postView(
      JSON.stringify({ function: "0x1::coin::supply", type_arguments: [], arguments: [] }),
    );

    const logged = stderrSpy.mock.calls.flat().join("\n");
    expect(status).toBe(502);
    expect(body.message).not.toContain(rawSecret);
    expect(body.message).toContain("***REDACTED***");
    expect(logged).not.toContain(rawSecret);
    expect(logged).toContain("***REDACTED***");
  });

  it("forwards JSON Accept and X-Aptos-Client headers to upstream", async () => {
    fakeApi.view.mockResolvedValueOnce(["forwarded"]);

    server = new ForkServer(forkDir, 0);
    await server.start();
    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const port = internal.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/v1/view`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Aptos-Client": "my-test-client/1.0",
      },
      body: JSON.stringify({ function: "0x1::coin::supply" }),
    });

    expect(res.status).toBe(200);
    expect(fakeApi.view).toHaveBeenCalledWith(
      { function: "0x1::coin::supply" },
      {
        Accept: "application/json",
        "X-Aptos-Client": "my-test-client/1.0",
      },
      "0",
    );
  });

  it("rejects BCS view responses with a JSON 406 before contacting upstream", async () => {
    const res = await startAndFetch("/v1/view", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-bcs" },
      body: JSON.stringify({ function: "0x1::coin::supply" }),
    });
    expect(res.status).toBe(406);
    expect(await res.json()).toMatchObject({ error_code: "unsupported_response_format" });
    expect(fakeApi.view).not.toHaveBeenCalled();
  });

  it("returns 413 body_too_large when the request body exceeds 1 MiB", async () => {
    // Build a payload just over 1 MiB so the limit fires mid-stream; the
    // JSON wrapper adds ~30 bytes around the inner string. The broken
    // pre-fix code called req.destroy() before sendJSON ran, so fetch saw
    // a connection reset instead of this envelope.
    const big = "a".repeat(1024 * 1024 + 1024);
    const body = JSON.stringify({ function: "0x1::coin::supply", arguments: [big] });

    const { status, body: respBody } = await postView(body);

    expect(status).toBe(413);
    expect(respBody.error_code).toBe("body_too_large");
    expect(fakeApi.view).not.toHaveBeenCalled();
  });

  it("blocks untrusted Origin before routing POST /v1/view", async () => {
    fakeApi.view.mockResolvedValueOnce(["should-not-run"]);

    const res = await startAndFetch("/v1/view", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ function: "0x1::coin::supply" }),
    });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error_code).toBe("cors_origin_forbidden");
    expect(fakeApi.view).not.toHaveBeenCalled();
  });

  it("returns 405 with Allow for wrong methods on known endpoints", async () => {
    const ledger = await startAndFetch("/v1/", { method: "POST" });
    expect(ledger.status).toBe(405);
    expect(ledger.headers.get("allow")).toBe("GET");
    expect((await ledger.json()).error_code).toBe("method_not_allowed");

    await server?.stop();
    server = null;

    const view = await startAndFetch("/v1/view", { method: "GET" });
    expect(view.status).toBe(405);
    expect(view.headers.get("allow")).toBe("POST");
    expect((await view.json()).error_code).toBe("method_not_allowed");
  });

  it("returns 400 malformed_path for invalid encoded resource paths", async () => {
    const res = await startAndFetch("/v1/accounts/0x1/resource/%ZZ");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error_code).toBe("malformed_path");
  });
});

// Regression coverage for #48 — the path regex deliberately accepts
// `0x[a-fA-F0-9]{1,64}` because Movement framework addresses use short forms
// (0x1, 0xa, ...). What matters is that downstream consistently normalizes,
// so short / padded / mixed-case inputs all collapse to the same canonical key.
describe("ForkServer — GET /v1/accounts/:address normalization consistency (#48)", () => {
  let forkDir: string;
  let server: ForkServer | null = null;

  beforeEach(() => {
    forkDir = makeForkDir();
    fakeApi.getAccount.mockReset();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    rmSync(forkDir, { recursive: true, force: true });
  });

  async function startAndGetAccount(path: string): Promise<Response> {
    server = new ForkServer(forkDir, 0);
    await server.start();
    const internal = (server as unknown as { server: { address(): AddressInfo } }).server;
    const port = internal.address().port;
    return fetch(`http://127.0.0.1:${port}${path}`);
  }

  const PADDED_ONE = "0x" + "0".repeat(63) + "1";

  it("short address (0x1) reaches upstream with the canonical padded form", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "0",
      authentication_key: PADDED_ONE,
    });

    const res = await startAndGetAccount("/v1/accounts/0x1");

    expect(res.status).toBe(200);
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
    expect(fakeApi.getAccount.mock.calls[0]![0]).toBe(PADDED_ONE);
  });

  it("padded form (0x0..01) reaches upstream with the same canonical key", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "0",
      authentication_key: PADDED_ONE,
    });

    const res = await startAndGetAccount(`/v1/accounts/${PADDED_ONE}`);

    expect(res.status).toBe(200);
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
    // Same canonical form as the short-address test above — both collapse here.
    expect(fakeApi.getAccount.mock.calls[0]![0]).toBe(PADDED_ONE);
  });

  it("once cached, the second form is served from local storage (no extra upstream call)", async () => {
    // This is the consistency proof: after a short-form request populates
    // the cache, a padded-form request for the same address must hit cache
    // (zero additional upstream calls).
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "0",
      authentication_key: PADDED_ONE,
    });

    const shortRes = await startAndGetAccount("/v1/accounts/0x1");
    expect(shortRes.status).toBe(200);
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);

    // Fresh server, same forkDir → storage persists.
    await server!.stop();
    server = null;
    const paddedRes = await startAndGetAccount(`/v1/accounts/${PADDED_ONE}`);
    expect(paddedRes.status).toBe(200);
    // No additional upstream call — same cache entry served both forms.
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
  });

  it("mixed-case address (0xABCdef) is normalized to lowercase canonical form", async () => {
    fakeApi.getAccount.mockResolvedValue({
      sequence_number: "0",
      authentication_key: "0x" + "0".repeat(58) + "abcdef",
    });

    const res = await startAndGetAccount("/v1/accounts/0xABCdef");

    expect(res.status).toBe(200);
    expect(fakeApi.getAccount).toHaveBeenCalledTimes(1);
    const callArg = fakeApi.getAccount.mock.calls[0]![0] as string;
    // Canonical form: lowercase, 0x-prefixed, padded to 64 hex.
    expect(callArg).toBe("0x" + "0".repeat(58) + "abcdef");
  });
});
