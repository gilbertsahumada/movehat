#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const [mode, path, resourceType] = process.argv.slice(2);
if (!mode || !path || !resourceType) {
  console.error('Usage: fork-e2e-assert-json.mjs <mode> <path> <resource-type>');
  process.exit(2);
}

let body;
try {
  body = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let valid = false;
if (mode === 'ledger') {
  valid = body?.chain_id === 250 && body?.git_hash === 'movehat-fork';
} else if (mode === 'resource') {
  valid = body?.type === resourceType && body?.data?.value === '999';
} else if (mode === 'resources') {
  valid = Array.isArray(body) && body.length === 1 &&
    body[0]?.type === resourceType && body[0]?.data?.value === '999';
}

if (!valid) {
  console.error(`Unexpected ${mode} response shape: ${JSON.stringify(body)}`);
  process.exit(1);
}
