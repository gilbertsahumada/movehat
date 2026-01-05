import Table from 'cli-table3';
import { shouldUseColor, colors } from './colors.js';

/**
 * Table preset types for different use cases
 */
export type TablePreset = 'default' | 'compact' | 'markdown' | 'borderless';

/**
 * Column alignment options
 */
export type Alignment = 'left' | 'center' | 'right';

/**
 * Table configuration options
 */
export interface TableConfig {
  /** Column headers */
  head?: string[];
  /** Preset style (default: 'default') */
  preset?: TablePreset;
  /** Column widths (optional) */
  colWidths?: number[];
  /** Column alignments (optional) */
  colAligns?: Alignment[];
  /** Custom style overrides */
  style?: {
    head?: string[];
    border?: string[];
  };
}

/**
 * Get preset configuration for table styling
 * Automatically respects color settings (NO_COLOR, TTY)
 *
 * @param preset - Preset name
 * @returns Partial cli-table3 configuration
 */
const getPresetConfig = (preset: TablePreset): Partial<Table.TableConstructorOptions> => {
  const hasColor = shouldUseColor();

  const presets: Record<TablePreset, Partial<Table.TableConstructorOptions>> = {
    /**
     * Default preset - Full borders with colors
     * Best for: Complex tables with multiple columns
     */
    default: {
      chars: {
        'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
        'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
        'right': '│', 'right-mid': '┤', 'middle': '│',
      },
      style: {
        head: hasColor ? ['cyan'] : [],
        border: hasColor ? ['gray'] : [],
      },
    },

    /**
     * Compact preset - Minimal borders, max readability
     * Best for: Fork list and similar data displays
     */
    compact: {
      chars: {
        'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
        'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
        'left': '', 'left-mid': '', 'mid': '', 'mid-mid': '',
        'right': '', 'right-mid': '', 'middle': ' │ ',
      },
      style: {
        head: hasColor ? ['cyan', 'bold'] : [],
        border: [],
      },
    },

    /**
     * Markdown preset - Markdown-compatible table format
     * Best for: Copy-paste to documentation
     */
    markdown: {
      chars: {
        'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
        'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
        'left': '|', 'left-mid': '', 'mid': '', 'mid-mid': '',
        'right': '|', 'right-mid': '', 'middle': '|',
      },
      style: {
        head: hasColor ? ['cyan'] : [],
        border: [],
      },
    },

    /**
     * Borderless preset - Clean, minimal appearance
     * Best for: Key-value displays and metadata
     */
    borderless: {
      chars: {
        'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
        'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
        'left': '', 'left-mid': '', 'mid': '', 'mid-mid': '',
        'right': '', 'right-mid': '', 'middle': '  ',
      },
      style: {
        head: hasColor ? ['cyan', 'bold'] : [],
        border: [],
      },
    },
  };

  return presets[preset];
};

/**
 * Create a table with preset configuration
 * Wrapper around cli-table3 with Movehat-specific styling
 *
 * @param config - Table configuration
 * @returns cli-table3 Table instance
 *
 * @example
 * const table = createTable({
 *   head: ['Name', 'Network', 'Chain ID', 'Accounts'],
 *   preset: 'compact'
 * });
 *
 * table.push(['testnet-fork', 'testnet', '126', '5']);
 * table.push(['mainnet-fork', 'mainnet', '1', '3']);
 *
 * console.log(table.toString());
 */
export const createTable = (config: TableConfig = {}): Table.Table => {
  const {
    head,
    preset = 'default',
    colWidths,
    colAligns,
    style = {},
  } = config;

  const presetConfig = getPresetConfig(preset);

  const tableConfig: Table.TableConstructorOptions = {
    ...presetConfig,
    style: {
      ...presetConfig.style,
      ...style,
    },
  };

  // Only add optional properties if they are defined
  if (head) tableConfig.head = head;
  if (colWidths) tableConfig.colWidths = colWidths;
  if (colAligns) tableConfig.colAligns = colAligns;

  return new Table(tableConfig);
};

/**
 * Create a simple key-value table
 * Perfect for displaying metadata and configuration
 *
 * @param data - Object with key-value pairs
 * @param preset - Table preset to use (default: 'borderless')
 * @returns cli-table3 Table instance ready for display
 *
 * @example
 * const metadata = {
 *   'Chain ID': '126',
 *   'Network': 'testnet',
 *   'Ledger Version': '12345',
 *   'Created At': new Date().toLocaleString()
 * };
 *
 * const table = createKVTable(metadata);
 * console.log(table.toString());
 */
export const createKVTable = (
  data: Record<string, string | number>,
  preset: TablePreset = 'borderless'
): Table.Table => {
  const table = createTable({ preset });

  for (const [key, value] of Object.entries(data)) {
    table.push([colors.dim(key), String(value)]);
  }

  return table;
};
