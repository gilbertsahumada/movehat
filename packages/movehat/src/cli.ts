#!/usr/bin/env node
import { Command, InvalidOptionArgumentError } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import testCommand from './commands/test.js';
import testMoveCommand from './commands/test-move.js';
import compileCommand from './commands/compile.js';
import initCommand from './commands/init.js';
import runCommand from './commands/run.js';
import updateCommand from './commands/update.js';
import forkCreateCommand from './commands/fork/create.js';
import forkViewResourceCommand from './commands/fork/view-resource.js';
import forkFundCommand from './commands/fork/fund.js';
import forkListCommand from './commands/fork/list.js';
import forkServeCommand from './commands/fork/serve.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

/**
 * Parse and validate port number
 */
function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new InvalidOptionArgumentError('Port must be an integer between 1 and 65535');
  }
  return port;
}

const program = new Command();

program
  .name('movehat')
  .description('A CLI tool for managing Move smart contracts')
  .version(version)
  .option('--network <name>', 'Network to use (testnet, mainnet, local, etc.)')
  .option('--redeploy', 'Force redeploy even if already deployed')
  .hook('preAction', (thisCommand) => {
    // Store network option in environment for commands to access
    const options = thisCommand.opts();
    if (options.network) {
      process.env.MH_CLI_NETWORK = options.network;
    }
    if (options.redeploy) {
      process.env.MH_CLI_REDEPLOY = 'true';
    }
  });

program
    .command('init [project-name]')
    .description('Initialize a new Move project in the current directory')
    .action((projectName) => {
        initCommand(projectName);
    });

program
    .command('compile')
    .description('Compile Move smart contracts using Movement CLI')
    .action(compileCommand);

program
    .command('run <script>')
    .description('Run a TypeScript/JavaScript script (e.g., deployment script)')
    .action(runCommand);

program
    .command('test')
    .description('Run all tests (Move + TypeScript)')
    .option('--move-only', 'Run only Move unit tests')
    .option('--ts-only', 'Run only TypeScript integration tests')
    .option('--watch', 'Run TypeScript tests in watch mode (implies --ts-only)')
    .option('--filter <pattern>', 'Filter Move tests by name pattern (Move tests only)')
    .action((options) => testCommand(options));

program
    .command('test:move')
    .description('Run Move unit tests')
    .option('--filter <pattern>', 'Filter tests by name pattern')
    .option('--ignore-warnings', 'Ignore compilation warnings')
    .action((options) => testMoveCommand(options));

program
    .command('test:ts')
    .description('Run TypeScript integration tests')
    .option('--watch', 'Run tests in watch mode')
    .action((options) => testCommand({ tsOnly: true, watch: options.watch }));

program
    .command('update')
    .description('Check for updates and upgrade to the latest version')
    .action(() => updateCommand());

// Fork commands
const fork = program
    .command('fork')
    .description('Manage local forks of Movement/Aptos networks');

fork
    .command('create')
    .description('Create a new fork from a network')
    .option('-n, --name <name>', 'Name for the fork')
    .option('-p, --path <path>', 'Custom path for the fork')
    .action((options) => forkCreateCommand(options));

fork
    .command('view-resource')
    .description('View a resource from the fork')
    .option('-f, --fork <path>', 'Path to the fork')
    .requiredOption('-a, --account <address>', 'Account address')
    .requiredOption('-r, --resource <type>', 'Resource type')
    .action((options) => forkViewResourceCommand(options));

fork
    .command('fund')
    .description('Fund an account in the fork')
    .option('-f, --fork <path>', 'Path to the fork')
    .requiredOption('-a, --account <address>', 'Account address')
    .requiredOption('--amount <amount>', 'Amount to fund')
    .option('--coin-type <type>', 'Coin type', '0x1::aptos_coin::AptosCoin')
    .action((options) => forkFundCommand(options));

fork
    .command('list')
    .description('List all available forks')
    .action(() => forkListCommand());

fork
    .command('serve')
    .description('Start a local RPC server serving the fork')
    .option('-f, --fork <path>', 'Path to the fork')
    .option('-p, --port <port>', 'Port to listen on (default: 8080)', parsePort, 8080)
    .action((options) => forkServeCommand(options));

program.parse(process.argv);
