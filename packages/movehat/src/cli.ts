#!/usr/bin/env node
import { Command } from 'commander';
import testCommand from './commands/test.js';
import compileCommand from './commands/compile.js';
import initCommand from './commands/init.js';
import runCommand from './commands/run.js';
import forkCreateCommand from './commands/fork/create.js';
import forkViewResourceCommand from './commands/fork/view-resource.js';
import forkFundCommand from './commands/fork/fund.js';
import forkListCommand from './commands/fork/list.js';
import forkServeCommand from './commands/fork/serve.js';
import { printMovehatBanner } from './helpers/banner.js';

const program = new Command();

printMovehatBanner();

program
  .name('movehat')
  .description('A CLI tool for managing Move smart contracts')
  .version('0.0.1')
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
    .description('Run TypeScript tests with Mocha')
    .action(testCommand);

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
    .option('-p, --port <port>', 'Port to listen on (default: 8080)', '8080')
    .action((options) => forkServeCommand({ ...options, port: parseInt(options.port) }));

program.parse(process.argv);
