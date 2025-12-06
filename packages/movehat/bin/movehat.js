#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the path to the TypeScript CLI file
const cliPath = join(__dirname, '..', 'src', 'cli.ts');

// Execute the CLI with tsx
const child = spawn('tsx', [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
