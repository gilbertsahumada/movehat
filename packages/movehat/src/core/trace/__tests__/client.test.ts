import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountAuthenticator, AnyRawTransaction } from "@aptos-labs/ts-sdk";

import { traceTransaction } from "../client.js";
import type { TraceResponse } from "../types.js";
import sample from "./fixtures/counter-increment.json" with { type: "json" };

// Stub the only SDK runtime symbol the client uses, so the test needs no real
// signing material.
vi.mock("@aptos-labs/ts-sdk", () => ({
  generateSignedTransaction: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
}));

const fakeTxn = {} as AnyRawTransaction;
const fakeAuth = {} as AccountAuthenticator;

describe("traceTransaction", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("POSTs the signed bytes to /transactions/trace?commit=true with the BCS content type", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(sample), { status: 200 })
    );

    const { response, elapsedMs } = await traceTransaction({
      rpcUrl: "http://127.0.0.1:8090/v1",
      transaction: fakeTxn,
      senderAuthenticator: fakeAuth,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://127.0.0.1:8090/v1/transactions/trace?commit=true"
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x.aptos.signed_transaction+bcs"
    );
    // No Accept header is sent (response must be JSON, not BCS).
    expect((init.headers as Record<string, string>)["Accept"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(Uint8Array);

    expect(response.txn_hash).toBe(sample.txn_hash);
    expect(response.success).toBe(true);
    expect(typeof elapsedMs).toBe("number");
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("throws on a non-2xx response, surfacing status and body", async () => {
    fetchMock.mockResolvedValue(
      new Response("bad transaction", { status: 400, statusText: "Bad Request" })
    );

    await expect(
      traceTransaction({
        rpcUrl: "http://127.0.0.1:8090/v1",
        transaction: fakeTxn,
        senderAuthenticator: fakeAuth,
      })
    ).rejects.toThrow(/400.*bad transaction/s);
  });

  it("surfaces the `message` from a movelite JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "transaction aborted",
          error_code: "vm_error",
          vm_error_code: 4004,
        }),
        { status: 400, statusText: "Bad Request" }
      )
    );

    await expect(
      traceTransaction({
        rpcUrl: "http://127.0.0.1:8090/v1",
        transaction: fakeTxn,
        senderAuthenticator: fakeAuth,
      })
    ).rejects.toThrow(/transaction aborted \(vm_error, 4004\)/);
  });

  it("falls back to raw text when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("plain text failure", { status: 500, statusText: "Error" })
    );

    await expect(
      traceTransaction({
        rpcUrl: "http://127.0.0.1:8090/v1",
        transaction: fakeTxn,
        senderAuthenticator: fakeAuth,
      })
    ).rejects.toThrow(/500.*plain text failure/s);
  });
});

describe("trace JSON contract (counter-increment fixture)", () => {
  const trace = sample as unknown as TraceResponse;

  it("carries the response-level fields", () => {
    expect(trace.success).toBe(true);
    expect(trace.abort).toBeNull();
    expect(trace.vm_status).toBe("Executed successfully");
    // gas_used is octas (small); root.gas is internal VM units (large) — distinct.
    expect(trace.gas_used).toBeLessThan(trace.root.gas);
  });

  it("decodes the user entry frame and its args", () => {
    expect(trace.root.kind).toBe("function");
    expect(trace.root.module).toContain("::counter");
    expect(trace.root.function).toBe("increment");
    // u64 args arrive as strings.
    expect(trace.root.args[0]).toEqual({ type: "u64", value: "5" });
  });

  it("models storage ops with the address-nullability quirk", () => {
    const ops = trace.root.storage;
    // load_resource carries the resolved address; mutating ops
    // (borrow_global_mut / move_to) carry a null address.
    const load = ops.find((o) => o.op === "load_resource");
    const nullAddrOp = ops.find((o) => o.address === null);
    expect(load?.address).toBeTypeOf("string");
    expect(nullAddrOp).toBeDefined();
    expect(nullAddrOp?.address).toBeNull();
  });
});
