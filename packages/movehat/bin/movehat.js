#!/usr/bin/env node

// Suppress experimental JSON module warning
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' &&
      warning.message.includes('Importing JSON modules')) {
    return;
  }
  console.warn(warning);
});

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the path to the compiled CLI file
const cliPath = join(__dirname, '..', 'dist', 'cli.js');

// Import and run the CLI
await import(cliPath);
