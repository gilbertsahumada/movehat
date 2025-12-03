import { Command } from 'commander';
import deployCommand from './commands/deploy.js';
import testCommand from './commands/test.js';

const program = new Command();

program
  .name('movehat')
  .description('A CLI tool for managing Move smart contracts')
  .version('1.0.0');

program
    .name("movehat")
    .description("A CLI tool for managing Move smart contracts")
    .version("0.0.1");

program
    .command('deploy')
    .description('Deploy Move smart contracts to the specified network')
    .action(deployCommand);

program
    .command('test')
    .description('Run tests for Move smart contracts')
    .action(testCommand);

program.parse(process.argv);