import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { MovementApiClient } from '../api.js';
import { MovementApiError } from '../errors.js';

const openServers: ReturnType<typeof createServer>[] = [];

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler);
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
});

describe('MovementApiClient hardening', () => {
  it('pins account, resource-list, resource, and view reads to ledger_version', async () => {
    const urls: string[] = [];
    const baseUrl = await startServer((req, res) => {
      urls.push(req.url ?? '');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        res.end('["view-result"]');
      } else if (req.url?.includes('/resource/')) {
        res.end('{"type":"0x1::m::R","data":{"value":"1"}}');
      } else if (req.url?.includes('/resources')) {
        res.end('[]');
      } else {
        res.end('{"sequence_number":"0","authentication_key":"0x1"}');
      }
    });
    const client = new MovementApiClient(baseUrl);

    await client.getAccount('0x1', '123');
    await client.getAccountResource('0x1', '0x1::m::R', '123');
    await client.getAccountResources('0x1', '123');
    await client.view({ function: '0x1::m::v' }, {}, '123');

    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(new URL(url, baseUrl).searchParams.get('ledger_version')).toBe('123');
    }
  });

  it('returns a typed HTTP error without reflecting the upstream body', async () => {
    const secret = 'private_key=do-not-reflect';
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end(secret);
    });

    const error = await new MovementApiClient(baseUrl)
      .getAccount('0x1', '1')
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(MovementApiError);
    expect(error).toMatchObject({ code: 'http_error', statusCode: 404 });
    expect((error as Error).message).not.toContain(secret);
  });

  it('distinguishes timeouts from other network failures', async () => {
    const baseUrl = await startServer(() => {
      // Intentionally leave the response open until the client aborts it.
    });
    const client = new MovementApiClient(baseUrl, undefined, { timeoutMs: 20 });

    await expect(client.getAccount('0x1')).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('rejects oversized and schema-invalid responses with typed errors', async () => {
    const oversizedUrl = await startServer((_req, res) => {
      res.end(JSON.stringify({ value: 'x'.repeat(256) }));
    });
    await expect(
      new MovementApiClient(oversizedUrl, undefined, { maxBytes: 32 }).getAccount('0x1')
    ).rejects.toMatchObject({ code: 'response_too_large' });

    const invalidUrl = await startServer((_req, res) => {
      res.end('{"unexpected":true}');
    });
    await expect(new MovementApiClient(invalidUrl).getAccount('0x1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects unsafe options, protocols, ledger versions, and view response shapes', async () => {
    expect(() => new MovementApiClient('file:///tmp/node')).toThrow(/Unsupported/);
    expect(() => new MovementApiClient('http://localhost', undefined, { timeoutMs: 0 })).toThrow(
      /timeoutMs/
    );

    const baseUrl = await startServer((_req, res) => res.end('{"not":"an array"}'));
    const client = new MovementApiClient(baseUrl);
    await expect(client.getAccount('0x1', '-1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(client.view({ function: '0x1::m::v' }, {}, '1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
