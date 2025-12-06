#!/usr/bin/env node
import { Command } from 'commander';
import testCommand from './commands/test.js';
import compileCommand from './commands/compile.js';
import initCommand from './commands/init.js';
import runCommand from './commands/run.js';

const program = new Command();

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

program.parse(process.argv);
