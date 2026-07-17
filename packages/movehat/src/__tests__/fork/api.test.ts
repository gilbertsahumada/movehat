import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";

/**
 * Tests for `MovementApiClient` Authorization header injection —
 * verifies the apiKey threading from `Harness.createFork`.
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

const httpsRequest = vi.fn();
const httpRequest = vi.fn();

vi.mock("https", () => ({
  default: { request: httpsRequest },
  request: httpsRequest,
}));
vi.mock("http", () => ({
  default: { request: httpRequest },
  request: httpRequest,
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
  captured: { url?: string; options?: { headers?: Record<string, string> }; endCalls: number };
} {
  const captured: {
    url?: string;
    options?: { headers?: Record<string, string> };
    endCalls: number;
  } = { endCalls: 0 };

  const handler = (
    url: URL | string,
    options:
      | { headers?: Record<string, string> }
      | ((res: IncomingMessage) => void),
    cb?: (res: IncomingMessage) => void
  ): ClientRequest => {
    captured.url = String(url);
    // Distinguish (url, callback) vs (url, options, callback) overloads.
    let callback: ((res: IncomingMessage) => void) | undefined;
    if (typeof options === "function") {
      callback = options;
    } else {
      captured.options = options;
      callback = cb;
    }

    const fakeReq = new EventEmitter() as unknown as ClientRequest;
    (fakeReq as unknown as { end: () => void }).end = () => { captured.endCalls += 1; };
    (fakeReq as unknown as { write: (data: string) => void }).write = () => {};
    // F3: api.ts now installs a setTimeout on the request and may call
    // destroy() on overflow / timeout. Stub both so this happy-path
    // capture mock still satisfies the new contract.
    (fakeReq as unknown as { setTimeout: (ms: number, cb?: () => void) => void }).setTimeout = () => {};
    (fakeReq as unknown as { destroy: () => void }).destroy = () => {};

    if (callback) {
      const body = JSON.stringify({
        chain_id: 250,
        ledger_version: "1",
        oldest_ledger_version: "0",
        ledger_timestamp: "0",
        node_role: "full_node",
        epoch: "0",
        oldest_block_height: "0",
        block_height: "0",
      });
      callback(makeFakeResponse(body));
    }
    return fakeReq;
  };

  httpsRequest.mockImplementation(handler);
  httpRequest.mockImplementation(handler);

  return { captured };
}

describe("MovementApiClient — Authorization header (apiKey wiring)", () => {
  beforeEach(() => {
    httpsRequest.mockReset();
    httpRequest.mockReset();
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
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(captured.endCalls).toBe(1);
  });

  it("omits the Authorization header when constructed without an apiKey (back-compat)", async () => {
    const { captured } = setupGetCapture();

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient("https://testnet.example.com/v1");

    await client.getLedgerInfo();

    expect(captured.url).toBe("https://testnet.example.com/v1/");
    if (captured.options !== undefined) {
      expect(captured.options.headers).not.toHaveProperty("Authorization");
    }
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(captured.endCalls).toBe(1);
  });

  it("rejects unsupported protocols and URL-embedded credentials", async () => {
    const { MovementApiClient } = await import("../../fork/api.js");
    expect(() => new MovementApiClient("file:///tmp/node")).toThrow(/protocol/i);
    expect(() => new MovementApiClient("https://user:secret@example.com/v1")).toThrow(
      /credentials/i
    );
  });

  it("keeps upstream error bodies private while preserving a safe error_code", async () => {
    httpsRequest.mockImplementation(
      (_url: URL, _options: unknown, callback: (res: IncomingMessage) => void) => {
        const req = new EventEmitter() as unknown as ClientRequest;
        (req as unknown as { end(): void }).end = () => {};
        (req as unknown as { write(data: string): void }).write = () => {};
        (req as unknown as { setTimeout(ms: number, cb?: () => void): void }).setTimeout = () => {};
        (req as unknown as { destroy(): void }).destroy = () => {};
        callback(makeFakeResponse(
          JSON.stringify({ message: "private upstream details", error_code: "version_pruned" }),
          410
        ));
        return req;
      }
    );
    const { MovementApiClient } = await import("../../fork/api.js");
    const { MovementApiError } = await import("../../fork/errors.js");

    const error = await new MovementApiClient("https://example.com/v1")
      .getLedgerInfo()
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(MovementApiError);
    expect((error as Error).message).not.toContain("private upstream details");
    expect((error as InstanceType<typeof MovementApiError>).upstreamErrorCode).toBe("version_pruned");
  });
});
