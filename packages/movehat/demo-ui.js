#!/usr/bin/env node

/**
 * Demo script to showcase the new UI system
 * Run with: node demo-ui.js
 */

import { logger, spinner, createTable, createKVTable, box, numberedList, bulletList, sectionHeader, formatCommand, divider, applyGradient, gradients, colors } from './dist/ui/index.js';

console.log('\n' + applyGradient('='.repeat(70), gradients.movehat));
console.log(applyGradient('           MOVEHAT UI SYSTEM DEMONSTRATION           ', gradients.movehat));
console.log(applyGradient('='.repeat(70), gradients.movehat) + '\n');

// 1. Logger Examples
logger.section('Logger Examples');
logger.info('This is an info message');
logger.success('This is a success message');
logger.warning('This is a warning message');
logger.error('This is an error message');
logger.newline();

// 2. Indented messages
logger.info('Parent message');
logger.kv('Network', 'testnet', 2);
logger.kv('Chain ID', '126', 2);
logger.kv('Status', colors.success('Active'), 2);
logger.newline();

// 3. List examples
logger.section('List Formatting');
logger.info('Next steps:');
logger.item('cd my-project', 2);
logger.item('npm install', 2);
logger.item('npm test', 2);
logger.newline();

const steps = numberedList([
  formatCommand('movehat compile'),
  formatCommand('movehat test'),
  formatCommand('movehat deploy')
], { indent: 2 });
console.log(steps);
logger.newline();

// 4. Box examples
logger.section('Box Formatting');
console.log(box('Update available: 1.0.0 → 1.1.0\nRun: movehat update', { borderColor: 'warning', padding: 2 }));
logger.newline();

console.log(box('✓ Build successful!\nAll tests passed', { borderColor: 'success', padding: 1 }));
logger.newline();

// 5. Table examples
logger.section('Table Examples');

// Compact table (for fork list)
const forkTable = createTable({
  head: ['Name', 'Network', 'Chain ID', 'Accounts', 'Created'],
  preset: 'compact',
  colWidths: [20, 15, 12, 12, 20]
});

forkTable.push(['testnet-fork', 'testnet', '126', '5', '2024-01-04 10:30']);
forkTable.push(['mainnet-fork', 'mainnet', '1', '3', '2024-01-03 14:15']);
forkTable.push(['devnet-fork', 'devnet', '177', '1', '2024-01-02 09:45']);

console.log(forkTable.toString());
logger.newline();

// Key-Value table (for metadata)
logger.info('Fork Details (Key-Value Table):');
const metadata = createKVTable({
  'Chain ID': '126',
  'Network': 'testnet',
  'Ledger Version': '123456',
  'Block Height': '789',
  'Epoch': '42',
  'Created At': new Date().toLocaleString()
});
console.log(metadata.toString());
logger.newline();

// 6. Spinner demonstration
logger.section('Spinner Demonstration');

async function demoSpinners() {
  const spin1 = spinner({ text: 'Fetching network data...' });
  await new Promise(resolve => setTimeout(resolve, 2000));
  spin1.succeed('Network data fetched!');

  const spin2 = spinner({ text: 'Compiling contracts...', color: 'cyan' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  spin2.succeed('Compilation complete!');

  const spin3 = spinner({ text: 'Running tests...', color: 'green' });
  await new Promise(resolve => setTimeout(resolve, 1000));
  spin3.fail('1 test failed');

  logger.newline();
  logger.success('Spinner demonstration complete!');
}

// 7. Dividers and sections
logger.newline();
console.log(divider(70));
console.log(colors.brandBright('                    End of Demonstration                    '));
console.log(divider(70));
logger.newline();

// Run spinner demo
demoSpinners();
