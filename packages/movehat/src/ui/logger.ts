import { colors } from './colors.js';
import { coloredSymbol, symbols } from './symbols.js';

/**
 * Available log levels
 */
export type LogLevel = 'info' | 'success' | 'error' | 'warning' | 'debug';

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Suppress all output when true */
  silent?: boolean;
  /** Minimum log level to display */
  level?: LogLevel;
  /** Include timestamps in log messages */
  timestamp?: boolean;
}

/**
 * Internal logger state
 */
let config: LoggerConfig = {
  silent: false,
  level: 'info',
  timestamp: false,
};

/**
 * Configure logger globally
 *
 * @param newConfig - Partial configuration to merge with current config
 *
 * @example
 * // Silence all logs for testing
 * configureLogger({ silent: true });
 *
 * // Enable timestamps
 * configureLogger({ timestamp: true });
 */
export const configureLogger = (newConfig: Partial<LoggerConfig>): void => {
  config = { ...config, ...newConfig };
};

/**
 * Format message with optional indentation
 */
const formatMessage = (message: string, indent: number = 0): string => {
  const prefix = ' '.repeat(indent);
  return message.split('\n').map(line => prefix + line).join('\n');
};

/**
 * Info message (cyan)
 * Use for general information and status updates
 *
 * @param message - Message to log
 * @param indent - Number of spaces to indent (default: 0)
 *
 * @example
 * logger.info('Starting compilation...');
 * logger.info('Network: testnet', 2);
 */
export const info = (message: string, indent: number = 0): void => {
  if (config.silent) return;
  const formatted = formatMessage(message, indent);
  console.log(`${coloredSymbol('info')} ${formatted}`);
};

/**
 * Success message (green)
 * Use for completed operations and positive outcomes
 *
 * @param message - Message to log
 * @param indent - Number of spaces to indent (default: 0)
 *
 * @example
 * logger.success('Compilation finished!');
 * logger.success('All tests passed', 2);
 */
export const success = (message: string, indent: number = 0): void => {
  if (config.silent) return;
  const formatted = formatMessage(message, indent);
  console.log(`${coloredSymbol('success')} ${formatted}`);
};

/**
 * Error message (red)
 * Use for errors and failures
 *
 * @param message - Message to log
 * @param indent - Number of spaces to indent (default: 0)
 *
 * @example
 * logger.error('Compilation failed');
 * logger.error('File not found: config.ts', 2);
 */
export const error = (message: string, indent: number = 0): void => {
  if (config.silent) return;
  const formatted = formatMessage(message, indent);
  console.error(`${coloredSymbol('error')} ${formatted}`);
};

/**
 * Warning message (yellow)
 * Use for warnings and deprecated features
 *
 * @param message - Message to log
 * @param indent - Number of spaces to indent (default: 0)
 *
 * @example
 * logger.warning('Deprecated API used');
 * logger.warning('This feature will be removed in v2.0', 2);
 */
export const warning = (message: string, indent: number = 0): void => {
  if (config.silent) return;
  const formatted = formatMessage(message, indent);
  console.warn(`${coloredSymbol('warning')} ${formatted}`);
};

/**
 * Plain message without symbol
 * Use for continuation lines or when symbol is not appropriate
 *
 * @param message - Message to log
 *
 * @example
 * logger.info('Fork Details:');
 * logger.plain('   Chain ID: 126');
 * logger.plain('   Network: testnet');
 */
export const plain = (message: string): void => {
  if (config.silent) return;
  console.log(message);
};

/**
 * Empty line
 * Use for visual spacing between sections
 *
 * @example
 * logger.success('Build complete');
 * logger.newline();
 * logger.info('Next steps:');
 */
export const newline = (): void => {
  if (config.silent) return;
  console.log();
};

/**
 * Section header (bold, brand color)
 * Use for major section dividers
 *
 * @param title - Section title
 *
 * @example
 * logger.section('Fork Details');
 * logger.kv('Chain ID', '126', 2);
 * logger.kv('Network', 'testnet', 2);
 */
export const section = (title: string): void => {
  if (config.silent) return;
  console.log(`\n${colors.brandBright(title)}`);
};

/**
 * Key-value pair
 * Use for displaying structured data
 *
 * @param key - The key/label
 * @param value - The value
 * @param indent - Number of spaces to indent (default: 0)
 *
 * @example
 * logger.kv('Network', 'testnet', 2);
 * logger.kv('Chain ID', '126', 2);
 */
export const kv = (key: string, value: string, indent: number = 0): void => {
  if (config.silent) return;
  const prefix = ' '.repeat(indent);
  console.log(`${prefix}${colors.dim(key)}: ${value}`);
};

/**
 * List item with bullet
 * Use for lists and enumerated items
 *
 * @param text - Item text
 * @param indent - Number of spaces to indent (default: 0)
 *
 * @example
 * logger.info('Next steps:');
 * logger.item('cd my-project', 2);
 * logger.item('npm install', 2);
 * logger.item('npm test', 2);
 */
export const item = (text: string, indent: number = 0): void => {
  if (config.silent) return;
  const prefix = ' '.repeat(indent);
  console.log(`${prefix}${symbols.bullet} ${text}`);
};

/**
 * Logger namespace export
 * Provides all logging functions in a single namespace
 *
 * @example
 * import { logger } from './ui/index.js';
 *
 * logger.info('Starting...');
 * logger.success('Done!');
 */
export const logger = {
  configure: configureLogger,
  info,
  success,
  error,
  warning,
  plain,
  newline,
  section,
  kv,
  item,
};
