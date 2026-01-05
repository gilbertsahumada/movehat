import { colors } from './colors.js';
import { symbols } from './symbols.js';

/**
 * Border color options for boxes
 */
export type BorderColor = 'dim' | 'primary' | 'success' | 'error' | 'warning';

/**
 * Box formatting options
 */
export interface BoxOptions {
  /** Padding inside the box (default: 1) */
  padding?: number;
  /** Margin outside the box (default: 0) */
  margin?: number;
  /** Border color (default: 'dim') */
  borderColor?: BorderColor;
}

/**
 * Create a box around text with Unicode borders
 *
 * @param content - Text content to box (supports multiline)
 * @param options - Box formatting options
 * @returns Formatted box string
 *
 * @example
 * const message = box('Update available: 1.0.0 → 1.1.0');
 * console.log(message);
 * // ┌────────────────────────────────┐
 * // │ Update available: 1.0.0 → 1.1.0│
 * // └────────────────────────────────┘
 *
 * @example
 * const warning = box(
 *   'This feature is deprecated\nUse the new API instead',
 *   { borderColor: 'warning', padding: 2 }
 * );
 */
export const box = (
  content: string,
  options: BoxOptions = {}
): string => {
  const { padding = 1, margin = 0, borderColor = 'dim' } = options;

  const lines = content.split('\n');
  const maxWidth = Math.max(...lines.map(l => l.length));
  const innerWidth = maxWidth + padding * 2;

  const marginStr = ' '.repeat(margin);
  const paddingStr = ' '.repeat(padding);

  const colorFn = colors[borderColor] || colors.dim;

  const top = marginStr + colorFn(symbols.boxTopLeft + symbols.boxTop.repeat(innerWidth) + symbols.boxTopRight);
  const bottom = marginStr + colorFn(symbols.boxBottomLeft + symbols.boxBottom.repeat(innerWidth) + symbols.boxBottomRight);

  const middle = lines.map(line => {
    const padded = line.padEnd(maxWidth);
    return marginStr + colorFn(symbols.boxLeft) + paddingStr + padded + paddingStr + colorFn(symbols.boxRight);
  });

  return [top, ...middle, bottom].join('\n');
};

/**
 * List formatting options
 */
export interface ListOptions {
  /** Number of spaces to indent (default: 0) */
  indent?: number;
  /** Starting number for numbered lists (default: 1) */
  startFrom?: number;
  /** Custom symbol for bullet lists */
  symbol?: string;
}

/**
 * Create a numbered list
 *
 * @param items - Array of items to list
 * @param options - List formatting options
 * @returns Formatted numbered list string
 *
 * @example
 * const steps = numberedList([
 *   'cd my-project',
 *   'npm install',
 *   'npm test'
 * ]);
 * console.log(steps);
 * // 1. cd my-project
 * // 2. npm install
 * // 3. npm test
 */
export const numberedList = (
  items: string[],
  options: ListOptions = {}
): string => {
  const { indent = 0, startFrom = 1 } = options;
  const prefix = ' '.repeat(indent);

  return items
    .map((item, idx) => `${prefix}${startFrom + idx}. ${item}`)
    .join('\n');
};

/**
 * Create a bulleted list
 *
 * @param items - Array of items to list
 * @param options - List formatting options
 * @returns Formatted bulleted list string
 *
 * @example
 * const features = bulletList([
 *   'Feature A',
 *   'Feature B',
 *   'Feature C'
 * ]);
 * console.log(features);
 * // • Feature A
 * // • Feature B
 * // • Feature C
 *
 * @example
 * const tasks = bulletList(
 *   ['Task 1', 'Task 2'],
 *   { indent: 2, symbol: '→' }
 * );
 */
export const bulletList = (
  items: string[],
  options: ListOptions = {}
): string => {
  const { indent = 0, symbol = symbols.bullet } = options;
  const prefix = ' '.repeat(indent);

  return items
    .map(item => `${prefix}${symbol} ${item}`)
    .join('\n');
};

/**
 * Indent text block by a specified number of spaces
 *
 * @param text - Text to indent (supports multiline)
 * @param spaces - Number of spaces to indent
 * @returns Indented text
 *
 * @example
 * const code = 'function test() {\n  return true;\n}';
 * console.log(indent(code, 4));
 * //     function test() {
 * //       return true;
 * //     }
 */
export const indent = (text: string, spaces: number): string => {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map(line => prefix + line).join('\n');
};

/**
 * Create a horizontal divider line
 *
 * @param width - Width of the divider (default: 60)
 * @param char - Character to use (default: symbols.line)
 * @returns Formatted divider string
 *
 * @example
 * console.log(divider());
 * // ────────────────────────────────────────────────────────────
 *
 * @example
 * console.log(divider(40, '='));
 * // ========================================
 */
export const divider = (
  width: number = 60,
  char: string = symbols.line
): string => {
  return colors.dim(char.repeat(width));
};

/**
 * Format file path with dimmed parent directories
 * Highlights the filename while dimming the directory path
 *
 * @param filePath - Full file path
 * @returns Formatted path string
 *
 * @example
 * console.log(formatPath('/Users/name/project/src/file.ts'));
 * // /Users/name/project/src/file.ts
 * // (where the directory is dimmed and filename is bright)
 */
export const formatPath = (filePath: string): string => {
  const parts = filePath.split('/');
  const fileName = parts.pop() || '';
  const dirPath = parts.join('/');

  return colors.dim(dirPath + '/') + fileName;
};

/**
 * Create a section header with divider
 * Combines a bold title with a horizontal line
 *
 * @param title - Section title
 * @param options - Formatting options
 * @returns Formatted section header
 *
 * @example
 * console.log(sectionHeader('Fork Details'));
 * //
 * // Fork Details
 * // ────────────────────────────────────────────────────────────
 */
export const sectionHeader = (
  title: string,
  options: { width?: number; char?: string } = {}
): string => {
  const { width = 60, char = symbols.line } = options;
  return `\n${colors.brandBright(title)}\n${divider(width, char)}`;
};

/**
 * Format a command for display with dimmed prompt
 * Useful for showing example commands to users
 *
 * @param command - Command string
 * @returns Formatted command with $ prompt
 *
 * @example
 * console.log(formatCommand('movehat compile'));
 * // $ movehat compile
 * // (where $ is dimmed)
 *
 * @example
 * console.log(formatCommand('npm install'));
 * // $ npm install
 */
export const formatCommand = (command: string): string => {
  return `${colors.dim('$')} ${command}`;
};
