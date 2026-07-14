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
import lintCommand from './commands/lint.js';
import proveCommand from './commands/prove.js';
import updateCommand from './commands/update.js';
import forkCreateCommand from './commands/fork/create.js';
import forkViewResourceCommand from './commands/fork/view-resource.js';
import forkFundCommand from './commands/fork/fund.js';
import forkListCommand from './commands/fork/list.js';
import forkServeCommand from './commands/fork/serve.js';
import { checkForUpdates } from './helpers/version-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;
const packageName = packageJson.name;

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

// Check for updates at startup (skip if running update command or help)
const args = process.argv.slice(2);
const isUpdateCommand = args.includes('update');
const isHelpOnly = args.length === 0 || args.includes('-h') || args.includes('--help');

if (!isUpdateCommand && !isHelpOnly) {
  checkForUpdates(version, packageName);
}

const program = new Command();

program
  .name('movehat')
  .description('A CLI tool for managing Move smart contracts')
  .version(version)
  .option('--network <name>', 'Network to use (testnet, mainnet, local, etc.)')
  .option('--redeploy', 'Force redeploy even if already deployed')
  .option(
    '-v, --verbose',
    'Increase output verbosity (repeatable: -v subprocess output, -vv..-vvvv transaction traces on movelite)',
    (_value: string, previous: number) => previous + 1,
    0
  )
  .hook('preAction', (thisCommand) => {
    // Store network option in environment for commands to access
    const options = thisCommand.opts();
    if (options.network) {
      process.env.MH_CLI_NETWORK = options.network;
    }
    if (options.redeploy) {
      process.env.MH_CLI_REDEPLOY = 'true';
    }
    // `-v` is counted (0..4). Level >= 1 keeps the legacy MOVEHAT_VERBOSE=1
    // contract (isVerbose + its callers); MOVEHAT_VERBOSITY carries the
    // numeric level across the spawned test/script subprocess boundary.
    const level: number = options.verbose ?? 0;
    if (level >= 1) {
      process.env.MOVEHAT_VERBOSE = '1';
      process.env.MOVEHAT_VERBOSITY = String(level);
    }
  });

program
    .command('init [project-name]')
    .description('Initialize a new Move project in the current directory')
    .option('--force', 'Overwrite template files in an existing destination')
    .action(async (projectName, options) => {
        await initCommand(projectName, { force: options.force });
    });

program
    .command('compile')
    .description('Compile Move smart contracts (auto-detects named addresses and updates Move.toml)')
    .action(async () => compileCommand());

program
    .command('lint')
    .description('Lint Move smart contracts with the Movement CLI')
    .action(async () => lintCommand());

program
    .command('prove')
    .description('Run the Move Prover with the Movement CLI')
    .action(async () => proveCommand());

program
    .command('run <script>')
    .description('Run a TypeScript/JavaScript script (e.g., deployment script)')
    .action(async (script) => runCommand(script));

program
    .command('test')
    .description('Run tests (interactive menu if no flags provided)')
    .option('--move', 'Run only Move unit tests (fast, no node required)')
    .option('--ts', 'Run only TypeScript integration tests (starts local node)')
    .option('--all', 'Run all tests (Move + TypeScript)')
    .option('--watch', 'Run TypeScript tests in watch mode (implies --ts)')
    .option('--coverage', 'Collect Move coverage and print the coverage summary')
    .option('--filter <pattern>', 'Filter Move tests by name pattern')
    // Legacy flags for backward compatibility
    .option('--move-only', 'Alias for --move (deprecated)')
    .option('--ts-only', 'Alias for --ts (deprecated)')
    .action(async (options) => {
        // --watch implies --ts
        if (options.watch && !options.ts && !options.all) {
            options.ts = true;
        }
        await testCommand(options);
    });

program
    .command('test:move')
    .description('Run Move unit tests')
    .option('--filter <pattern>', 'Filter tests by name pattern')
    .option('--ignore-warnings', 'Ignore compilation warnings')
    .action(async (options) => testMoveCommand(options));

program
    .command('test:ts')
    .description('Run TypeScript integration tests')
    .option('--watch', 'Run tests in watch mode')
    .action(async (options) => testCommand({ tsOnly: true, watch: options.watch }));

program
    .command('update')
    .description('Check for updates and upgrade to the latest version')
    .action(async () => updateCommand());

// Fork commands
const fork = program
    .command('fork')
    .description('Manage local forks of Movement networks');

fork
    .command('create')
    .description('Create a new fork from a network')
    .option('-n, --name <name>', 'Name for the fork')
    .option('-p, --path <path>', 'Custom path for the fork')
    .action(async (options) => forkCreateCommand(options));

fork
    .command('view-resource')
    .description('View a resource from the fork')
    .option('-f, --fork <path>', 'Path to the fork')
    .requiredOption('-a, --account <address>', 'Account address')
    .requiredOption('-r, --resource <type>', 'Resource type')
    .action(async (options) => forkViewResourceCommand(options));

fork
    .command('fund')
    .description('Fund an account in the fork')
    .option('-f, --fork <path>', 'Path to the fork')
    .requiredOption('-a, --account <address>', 'Account address')
    .requiredOption('--amount <amount>', 'Amount to fund')
    .option('--coin-type <type>', 'Coin type', '0x1::aptos_coin::AptosCoin')
    .action(async (options) => forkFundCommand(options));

fork
    .command('list')
    .description('List all available forks')
    .action(async () => forkListCommand());

fork
    .command('serve')
    .description('Start a local RPC server serving the fork')
    .option('-f, --fork <path>', 'Path to the fork')
    .option('-p, --port <port>', 'Port to listen on (default: 8080)', parsePort, 8080)
    .option('--host <host>', 'Interface to bind (default: 127.0.0.1; use 0.0.0.0 to expose to LAN)', '127.0.0.1')
    .action(async (options) => forkServeCommand(options));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`movehat: ${message}`);
  process.exitCode = 1;
}
