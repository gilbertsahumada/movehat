import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";

/**
 * F3 — MovementApiClient must bound responses by time AND bytes.
 *
 * Without these guards a malicious / hung upstream can:
 *   - leak the request promise forever (never emits 'end'), or
 *   - exhaust heap by pushing unbounded `data` chunks.
 *
 * Strategy mirrors src/__tests__/fork/api.test.ts: vi.mock node:http
 * and node:https, intercept `client.get(url, options, cb)`, and feed
 * a controllable `IncomingMessage` to the callback. The fake
 * `ClientRequest` exposes `setTimeout`, `destroy`, and emits 'error' /
 * 'timeout' so we can drive the failure modes from the test.
 */

interface FakeReq extends EventEmitter {
  end(): void;
  write(data: string): void;
  destroy(err?: Error): void;
  setTimeout(ms: number, cb?: () => void): void;
  destroyed: boolean;
}

const httpsRequest = vi.fn();
const httpRequest = vi.fn();

vi.mock("https", () => ({ default: { request: httpsRequest }, request: httpsRequest }));
vi.mock("http", () => ({ default: { request: httpRequest }, request: httpRequest }));

function makeFakeReq(): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.destroyed = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  req.end = () => {};
  req.write = () => {};
  req.destroy = (err?: Error) => {
    req.destroyed = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    setImmediate(() => req.emit("error", err ?? new Error("destroyed")));
  };
  req.setTimeout = (ms: number, cb?: () => void) => {
    timeoutHandle = setTimeout(() => {
      req.emit("timeout");
      if (cb) cb();
    }, ms);
    // Don't keep the event loop alive — Node sets this itself but the
    // mock has no native socket to inherit from.
    timeoutHandle.unref?.();
  };
  return req;
}

function makeUnresolvableResponse(): IncomingMessage {
  const res = new EventEmitter() as unknown as IncomingMessage;
  (res as unknown as { statusCode: number }).statusCode = 200;
  return res;
}

function makeStreamingResponse(
  bytesPerChunk: number,
  chunks: number
): IncomingMessage {
  const res = new EventEmitter() as unknown as IncomingMessage;
  (res as unknown as { statusCode: number }).statusCode = 200;
  setImmediate(() => {
    let i = 0;
    const pump = () => {
      if (i >= chunks) {
        (res as unknown as EventEmitter).emit("end");
        return;
      }
      (res as unknown as EventEmitter).emit(
        "data",
        Buffer.alloc(bytesPerChunk, 0x61)
      );
      i++;
      setImmediate(pump);
    };
    pump();
  });
  return res;
}

describe("F3 — MovementApiClient timeouts and byte cap", () => {
  beforeEach(() => {
    httpsRequest.mockReset();
    httpRequest.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects with a timeout error when the upstream never responds", async () => {
    const fakeReq = makeFakeReq();
    httpRequest.mockImplementation(
      (
        _url: string,
        options: unknown,
        cb?: (res: IncomingMessage) => void
      ) => {
        const callback =
          typeof options === "function"
            ? (options as (r: IncomingMessage) => void)
            : cb;
        if (callback) callback(makeUnresolvableResponse());
        return fakeReq as unknown as ClientRequest;
      }
    );

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient("http://hung.example/v1", undefined, {
      timeoutMs: 25,
      maxBytes: 1024 * 1024,
    });

    await expect(client.getLedgerInfo()).rejects.toThrow(/timed out|timeout/i);
    expect(fakeReq.destroyed).toBe(true);
  });

  it("enforces an absolute deadline even while the upstream trickles bytes", async () => {
    const fakeReq = makeFakeReq();
    httpRequest.mockImplementation((_url, _options, callback) => {
      const res = makeUnresolvableResponse();
      callback?.(res);
      const interval = setInterval(() => {
        (res as unknown as EventEmitter).emit("data", Buffer.from(" "));
      }, 5);
      interval.unref?.();
      (res as unknown as EventEmitter).once("aborted", () => clearInterval(interval));
      fakeReq.once("error", () => clearInterval(interval));
      return fakeReq as unknown as ClientRequest;
    });

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient("http://slow.example/v1", undefined, {
      timeoutMs: 30,
      maxBytes: 1024,
    });

    await expect(client.getLedgerInfo()).rejects.toThrow(/timed out/i);
    expect(fakeReq.destroyed).toBe(true);
  });

  it("rejects when the response is aborted before end", async () => {
    const fakeReq = makeFakeReq();
    httpRequest.mockImplementation((_url, _options, callback) => {
      const res = makeUnresolvableResponse();
      callback?.(res);
      setImmediate(() => (res as unknown as EventEmitter).emit("aborted"));
      return fakeReq as unknown as ClientRequest;
    });

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient("http://aborted.example/v1", undefined, {
      timeoutMs: 1000,
    });

    await expect(client.getLedgerInfo()).rejects.toThrow(/aborted/i);
  });

  it("rejects and destroys the request when the response exceeds maxBytes", async () => {
    const fakeReq = makeFakeReq();
    httpRequest.mockImplementation(
      (
        _url: string,
        options: unknown,
        cb?: (res: IncomingMessage) => void
      ) => {
        const callback =
          typeof options === "function"
            ? (options as (r: IncomingMessage) => void)
            : cb;
        if (callback) callback(makeStreamingResponse(2048, 100));
        return fakeReq as unknown as ClientRequest;
      }
    );

    const { MovementApiClient } = await import("../../fork/api.js");
    const client = new MovementApiClient("http://big.example/v1", undefined, {
      timeoutMs: 5000,
      maxBytes: 4096,
    });

    await expect(client.getLedgerInfo()).rejects.toThrow(
      /maxBytes|too large|exceeded/i
    );
    expect(fakeReq.destroyed).toBe(true);
  });
});
