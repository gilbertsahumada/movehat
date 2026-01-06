/**
 * Movehat UI Module
 *
 * Provides a comprehensive set of UI utilities for the CLI including:
 * - Colors and gradients (picocolors wrapper)
 * - Cross-platform symbols (figures wrapper)
 * - Structured logging system
 * - Spinners for async operations (ora wrapper)
 * - Table formatting (cli-table3 wrapper)
 * - Text formatting utilities
 *
 * @example
 * // Named imports (recommended)
 * import { logger, spinner, createTable } from './ui/index.js';
 *
 * logger.info('Starting compilation...');
 * const spin = spinner({ text: 'Compiling...' });
 * // ... async work ...
 * spin.succeed('Compilation complete!');
 *
 * @example
 * // Namespace import
 * import { ui } from './ui/index.js';
 *
 * ui.logger.info('Starting...');
 * ui.logger.success('Done!');
 */

// Re-export everything from submodules for named imports
export * from './colors.js';
export * from './symbols.js';
export * from './logger.js';
export * from './spinner.js';
export * from './table.js';
export * from './formatters.js';

// Also export as namespace for convenience
import * as _colors from './colors.js';
import * as _symbols from './symbols.js';
import * as _logger from './logger.js';
import * as _spinner from './spinner.js';
import * as _table from './table.js';
import * as _formatters from './formatters.js';

/**
 * Unified UI namespace
 * Provides all UI utilities in a single namespace object
 *
 * @example
 * import { ui } from './ui/index.js';
 *
 * ui.logger.info('Processing...');
 * ui.logger.success('Done!');
 */
export const ui = {
  colors: _colors,
  symbols: _symbols,
  logger: _logger,
  spinner: _spinner,
  table: _table,
  formatters: _formatters,
};
