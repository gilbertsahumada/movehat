import pc from 'picocolors';

/**
 * RGB type for gradient functions
 */
export type Rgb = [number, number, number];

/**
 * Detect if colors should be used
 * Respects NO_COLOR env var and TTY detection
 */
export const shouldUseColor = (): boolean => {
  return process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);
};

/**
 * Conditional color wrapper
 * Returns identity function if colors disabled
 */
const color = (fn: (str: string) => string) => {
  return shouldUseColor() ? fn : (str: string) => str;
};

/**
 * Semantic color palette
 * Maps intent to colors consistently across the CLI
 */
export const colors = {
  // Status colors
  success: color(pc.green),
  error: color(pc.red),
  warning: color(pc.yellow),
  info: color(pc.cyan),

  // UI element colors
  primary: color(pc.magenta),
  secondary: color(pc.blue),
  muted: color(pc.gray),
  dim: color(pc.dim),
  bold: color(pc.bold),

  // Movehat brand colors (amber/yellow gradient)
  brand: color(pc.yellow),
  brandBright: color((str: string) => pc.yellow(pc.bold(str))),

  // Direct access for advanced use
  raw: shouldUseColor() ? pc : createNoopColors(),
};

/**
 * Convert RGB to ANSI 24-bit color code
 *
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns ANSI escape code for RGB color
 *
 * @example
 * const red = rgbToAnsi(255, 0, 0);
 * console.log(`${red}This is red text\x1b[0m`);
 */
export const rgbToAnsi = (r: number, g: number, b: number): string => {
  return `\x1b[38;2;${r};${g};${b}m`;
};

/**
 * Apply gradient to text using RGB palette
 * Migrated from banner.ts for reuse across the application
 *
 * @param text - Text to colorize with gradient
 * @param palette - Array of RGB color values
 * @param offset - Starting offset in palette (useful for animation)
 * @returns Colored text with gradient applied
 *
 * @example
 * const gradient = applyGradient('MOVEHAT', gradients.movehat);
 * console.log(gradient);
 */
export const applyGradient = (
  text: string,
  palette: Rgb[],
  offset: number = 0
): string => {
  if (!shouldUseColor()) return text;

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const colorIndex = (i + offset) % palette.length;
    const color = palette[colorIndex];
    const ch = text[i];
    if (!color || ch === undefined) continue;
    const [r, g, b] = color;
    result += `${rgbToAnsi(r, g, b)}${ch}`;
  }
  return result + '\x1b[0m';
};

/**
 * Preset gradient palettes for consistent branding
 */
export const gradients = {
  /**
   * Movehat brand gradient (warm yellow/amber)
   * Used for the banner and brand-related UI elements
   */
  movehat: [
    [255, 239, 150],
    [255, 223, 88],
    [255, 207, 64],
    [255, 181, 45],
    [255, 160, 30],
  ] as Rgb[],

  /**
   * Success gradient (green tones)
   * For positive feedback and success states
   */
  success: [
    [144, 238, 144],
    [60, 179, 113],
    [46, 139, 87],
  ] as Rgb[],

  /**
   * Error gradient (red tones)
   * For errors and warnings
   */
  error: [
    [255, 182, 193],
    [220, 20, 60],
    [178, 34, 34],
  ] as Rgb[],
};

/**
 * No-op color functions for when colors are disabled
 * Uses a Proxy to return identity function for any property access
 */
function createNoopColors() {
  const noop = (str: string) => str;
  return new Proxy({} as typeof pc, {
    get: () => noop,
  });
}
