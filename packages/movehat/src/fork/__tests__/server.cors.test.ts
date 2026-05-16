import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { ForkServer } from "../server.js";

/**
 * F2 — ForkServer must not advertise `Access-Control-Allow-Origin: *`
 * by default. Cached fork state may include account resources fetched
 * from authenticated upstream nodes; any web page open in the dev's
 * browser should not be able to read it through the loopback listener.
 *
 * Default contract:
 *   - No CORS header emitted unless the caller opts in via
 *     `corsAllowOrigins`.
 *   - When opted in, only requests whose `Origin` is in the allowlist
 *     receive a matching `Access-Control-Allow-Origin` (echo of origin,
 *     not `*`).
 */

function makeForkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "movehat-fork-cors-"));
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

function boundPort(server: ForkServer): number {
  const internal = (server as unknown as {
    server: { address(): AddressInfo };
  }).server;
  const addr = internal.address();
  return addr.port;
}

async function fetchFromServer(
  port: number,
  origin?: string
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.Origin = origin;
  return fetch(`http://127.0.0.1:${port}/v1/`, { headers });
}

describe("F2 — ForkServer CORS is closed by default", () => {
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

  it("does not emit Access-Control-Allow-Origin by default", async () => {
    server = new ForkServer(forkDir, 0);
    await server.start();
    const port = boundPort(server);

    const res = await fetchFromServer(port, "https://evil.example");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes only allow-listed origins when corsAllowOrigins is set", async () => {
    server = new ForkServer(forkDir, 0, "127.0.0.1", {
      corsAllowOrigins: ["https://trusted.example"],
    });
    await server.start();
    const port = boundPort(server);

    const allowed = await fetchFromServer(port, "https://trusted.example");
    expect(allowed.headers.get("access-control-allow-origin")).toBe(
      "https://trusted.example"
    );

    const denied = await fetchFromServer(port, "https://evil.example");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });
});
