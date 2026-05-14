import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";

/**
 * Tests for `MovementApiClient` Authorization header injection (M2.4
 * follow-up — wires the apiKey threading from `Harness.createFork`).
 *
 * Strategy: `vi.mock` `node:https` and `node:http` so the test
 * captures the request options passed to `client.get(url, options, cb)`
 * without making real network requests. Two assertions:
 *
 *   1. When the client is constructed with an apiKey, every `get`
 *      call carries `Authorization: Bearer <apiKey>` in
 *      `options.headers`.
 *   2. When constructed without an apiKey, no Authorization header
 *      is added (back-compat for unauthenticated public endpoints).
 */

const httpsGet = vi.fn();
const httpGet = vi.fn();

vi.mock("https", () => ({
  default: { get: httpsGet },
  get: httpsGet,
}));
vi.mock("http", () => ({
  default: { get: httpGet },
  get: httpGet,
}));

/**
 * Build a fake `IncomingMessage`-like emitter that immediately emits
 * a valid JSON body and ends. The MovementApiClient.get callback
 * consumes the response via `data` / `end` events.
 */
function makeFakeResponse(body: string, statusCode = 200): IncomingMessage {
  const res = new EventEmitter() as unknown as IncomingMessage;
  (res as unknown as { statusCode: number }).statusCode = statusCode;
  // Use setImmediate so the listener attaches before the events fire.
  setImmediate(() => {
    (res as unknown as EventEmitter).emit("data", body);
    (res as unknown as EventEmitter).emit("end");
  });
  return res;
}

/**
 * Capture the options arg from `client.get(url, options, callback)`
 * and immediately resolve with a fake successful ledger-info response.
 * Returns the captured options for assertion.
 */
function setupGetCapture(): {
  captured: { url?: string; options?: { headers?: Record<string, string> } };
} {
  const captured: {
    url?: string;
    options?: { headers?: Record<string, string> };
  } = {};

  const handler = (
    url: string,
    options:
      | { headers?: Record<string, string> }
      | ((res: IncomingMessage) => void),
    cb?: (res: IncomingMessage) => void
  ): ClientRequest => {
    captured.url = url;
    // Distinguish (url, callback) vs (url, options, callback) overloads.
    let callback: ((res: IncomingMessage) => void) | undefined;
    if (typeof options === "function") {
      callback = options;
    } else {
      captured.options = options;
      callback = cb;
    }

    const fakeReq = new EventEmitter() as unknown as ClientRequest;
    (fakeReq as unknown as { end: () => void }).end = () => {};

    if (callback) {
      const body = JSON.stringify({
        chain_id: 250,
        ledger_version: "1",
        ledger_timestamp: "0",
        epoch: "0",
        block_height: "0",
      });
      callback(makeFakeResponse(body));
    }
    return fakeReq;
  };

  httpsGet.mockImplementation(handler);
  httpGet.mockImplementation(handler);

  return { captured };
}

describe("MovementApiClient — Authorization header (apiKey wiring)", () => {
  beforeEach(() => {
    httpsGet.mockReset();
    httpGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects 'Authorization: Bearer <apiKey>' when constructed with an apiKey", async () => {
    const { captured } = setupGetCapture();

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient(
      "https://testnet.example.com/v1",
      "secret-key-123"
    );

    await client.getLedgerInfo();

    expect(captured.url).toBe("https://testnet.example.com/v1/");
    expect(captured.options).toBeDefined();
    expect(captured.options?.headers).toEqual({
      Authorization: "Bearer secret-key-123",
    });
    expect(httpsGet).toHaveBeenCalledTimes(1);
  });

  it("omits the Authorization header when constructed without an apiKey (back-compat)", async () => {
    const { captured } = setupGetCapture();

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient("https://testnet.example.com/v1");

    await client.getLedgerInfo();

    expect(captured.url).toBe("https://testnet.example.com/v1/");
    if (captured.options !== undefined) {
      expect(captured.options.headers).toBeUndefined();
    }
    expect(httpsGet).toHaveBeenCalledTimes(1);
  });
});
