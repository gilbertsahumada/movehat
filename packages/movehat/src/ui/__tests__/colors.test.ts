import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  shouldUseColor,
  colors,
  rgbToAnsi,
  applyGradient,
  gradients,
} from '../colors.js';

describe('shouldUseColor', () => {
  const originalEnv = process.env;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY });
  });

  it('should return true when TTY and NO_COLOR not set', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    delete process.env.NO_COLOR;
    expect(shouldUseColor()).toBe(true);
  });

  it('should return false when NO_COLOR is set', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.NO_COLOR = '1';
    expect(shouldUseColor()).toBe(false);
  });

  it('should return false when not TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    delete process.env.NO_COLOR;
    expect(shouldUseColor()).toBe(false);
  });
});

describe('rgbToAnsi', () => {
  it('should generate correct ANSI escape code', () => {
    expect(rgbToAnsi(255, 0, 0)).toBe('\x1b[38;2;255;0;0m');
    expect(rgbToAnsi(0, 255, 0)).toBe('\x1b[38;2;0;255;0m');
    expect(rgbToAnsi(0, 0, 255)).toBe('\x1b[38;2;0;0;255m');
    expect(rgbToAnsi(128, 128, 128)).toBe('\x1b[38;2;128;128;128m');
  });

  it('should handle edge values', () => {
    expect(rgbToAnsi(0, 0, 0)).toBe('\x1b[38;2;0;0;0m');
    expect(rgbToAnsi(255, 255, 255)).toBe('\x1b[38;2;255;255;255m');
  });
});

describe('applyGradient', () => {
  const originalEnv = process.env;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY });
  });

  it('should apply gradient to text', () => {
    const palette = [[255, 0, 0], [0, 255, 0]] as [number, number, number][];
    const result = applyGradient('AB', palette);

    expect(result).toContain('\x1b[38;2;255;0;0m'); // Red for 'A'
    expect(result).toContain('\x1b[38;2;0;255;0m'); // Green for 'B'
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('\x1b[0m'); // Reset at end
  });

  it('should return plain text when colors disabled', () => {
    process.env.NO_COLOR = '1';
    const palette = [[255, 0, 0]] as [number, number, number][];
    const result = applyGradient('Hello', palette);

    expect(result).toBe('Hello');
    expect(result).not.toContain('\x1b');
  });

  it('should cycle through palette for long text', () => {
    const palette = [[255, 0, 0], [0, 255, 0]] as [number, number, number][];
    const result = applyGradient('ABCD', palette);

    // Should alternate: A=red, B=green, C=red, D=green
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toContain('D');
  });

  it('should handle offset parameter', () => {
    const palette = [[255, 0, 0], [0, 255, 0]] as [number, number, number][];
    const result = applyGradient('AB', palette, 1);

    // With offset 1: A=green, B=red
    expect(result.indexOf('\x1b[38;2;0;255;0m')).toBeLessThan(result.indexOf('\x1b[38;2;255;0;0m'));
  });
});

describe('gradients', () => {
  it('should have movehat gradient with 5 colors', () => {
    expect(gradients.movehat).toHaveLength(5);
    gradients.movehat.forEach(([r, g, b]) => {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    });
  });

  it('should have success gradient', () => {
    expect(gradients.success).toBeDefined();
    expect(gradients.success.length).toBeGreaterThan(0);
  });

  it('should have error gradient', () => {
    expect(gradients.error).toBeDefined();
    expect(gradients.error.length).toBeGreaterThan(0);
  });
});

describe('colors object', () => {
  it('should have all semantic color functions', () => {
    expect(typeof colors.success).toBe('function');
    expect(typeof colors.error).toBe('function');
    expect(typeof colors.warning).toBe('function');
    expect(typeof colors.info).toBe('function');
    expect(typeof colors.primary).toBe('function');
    expect(typeof colors.secondary).toBe('function');
    expect(typeof colors.muted).toBe('function');
    expect(typeof colors.dim).toBe('function');
    expect(typeof colors.bold).toBe('function');
    expect(typeof colors.brand).toBe('function');
    expect(typeof colors.brandBright).toBe('function');
  });

  it('should return strings when called', () => {
    expect(typeof colors.success('test')).toBe('string');
    expect(typeof colors.error('test')).toBe('string');
    expect(typeof colors.brand('test')).toBe('string');
  });
});
