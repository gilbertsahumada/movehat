import figures from 'figures';
import { colors } from './colors.js';

/**
 * Platform-aware symbols using the figures library
 * Automatically falls back to ASCII on unsupported terminals
 *
 * @example
 * console.log(`${symbols.success} Task completed`);
 * console.log(`${symbols.error} Task failed`);
 */
export const symbols = {
  // Status symbols
  success: figures.tick,          // ✔ or √
  error: figures.cross,           // ✖ or ×
  warning: figures.warning,       // ⚠ or ‼
  info: figures.info,             // ℹ or i

  // Action / progress symbols
  step: '▸',                 // ▸  — used to prefix in-progress action lines
                                  // (e.g. "▸ Building package"). Plain Unicode
                                  // BLACK RIGHT-POINTING SMALL TRIANGLE, supported
                                  // in every UTF-8 terminal. If a non-UTF-8
                                  // environment ever surfaces, switch to
                                  // figures.pointerSmall ('›' with ASCII fallback).
  pointer: figures.pointer,       // ❯ or >
  checkboxOn: figures.checkboxOn, // ☑ or [×]
  checkboxOff: figures.checkboxOff, // ☐ or [ ]

  // UI symbols
  bullet: figures.bullet,         // ● or *
  ellipsis: figures.ellipsis,     // … or ...
  line: figures.line,             // ─ or -
  arrow: figures.arrowRight,      // → or ->

  // Box drawing characters
  boxTop: '─',
  boxBottom: '─',
  boxLeft: '│',
  boxRight: '│',
  boxTopLeft: '┌',
  boxTopRight: '┐',
  boxBottomLeft: '└',
  boxBottomRight: '┘',

  // Semantic aliases for better code readability
  check: figures.tick,
  cross: figures.cross,
  radioOn: figures.radioOn,
  radioOff: figures.radioOff,
};

/**
 * Symbol types for colored symbol function
 */
export type SymbolType = 'success' | 'error' | 'warning' | 'info';

/**
 * Get a symbol with appropriate semantic color
 * Automatically applies the correct color based on symbol type
 *
 * @param type - The type of symbol ('success', 'error', 'warning', 'info')
 * @returns Colored symbol ready for console output
 *
 * @example
 * console.log(`${coloredSymbol('success')} Build successful`);
 * console.log(`${coloredSymbol('error')} Build failed`);
 */
export const coloredSymbol = (type: SymbolType): string => {
  switch (type) {
    case 'success':
      return colors.success(symbols.success);
    case 'error':
      return colors.error(symbols.error);
    case 'warning':
      return colors.warning(symbols.warning);
    case 'info':
      return colors.info(symbols.info);
  }
};
