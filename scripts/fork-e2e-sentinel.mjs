#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const [readyPath, hitsPath, resourceType] = process.argv.slice(2);
if (!readyPath || !hitsPath || !resourceType) {
  console.error('Usage: fork-e2e-sentinel.mjs <ready-file> <hits-file> <resource-type>');
  process.exit(2);
}

writeFileSync(hitsPath, '');

const server = http.createServer((req, res) => {
  appendFileSync(hitsPath, `${req.method ?? 'UNKNOWN'} ${req.url ?? '/'}\n`);

  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  let body;
  if (pathname.endsWith('/resources')) {
    body = [{ type: resourceType, data: { value: '999' } }];
  } else if (pathname.includes('/resource/')) {
    body = { type: resourceType, data: { value: '999' } };
  } else {
    body = {
      chain_id: 250,
      ledger_version: '51785699',
      ledger_timestamp: '1768081138455673',
      epoch: '2112064',
      block_height: '15673339',
    };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

server.once('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    console.error('Sentinel did not receive a TCP port');
    process.exit(1);
  }
  writeFileSync(readyPath, `${address.port}\n`);
});
