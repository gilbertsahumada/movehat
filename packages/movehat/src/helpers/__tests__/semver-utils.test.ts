import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../semver-utils.js';

describe('isNewerVersion', () => {
  describe('standard semver comparisons', () => {
    it('should detect newer major version', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
      expect(isNewerVersion('0.1.0', '1.0.0')).toBe(true);
    });

    it('should detect newer minor version', () => {
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
      expect(isNewerVersion('1.5.0', '1.6.0')).toBe(true);
    });

    it('should detect newer patch version', () => {
      expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
      expect(isNewerVersion('1.0.9', '1.0.10')).toBe(true);
    });

    it('should return false for same version', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('2.5.3', '2.5.3')).toBe(false);
    });

    it('should return false for older versions', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.1.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false);
    });
  });

  describe('variable-length version handling', () => {
    it('should handle two-part versions', () => {
      expect(isNewerVersion('1.0', '1.1')).toBe(true);
      expect(isNewerVersion('1.0', '2.0')).toBe(true);
      expect(isNewerVersion('1.1', '1.0')).toBe(false);
    });

    it('should compare versions with different lengths', () => {
      expect(isNewerVersion('1.0', '1.0.1')).toBe(true);
      expect(isNewerVersion('1.0.0', '1.1')).toBe(true);
      expect(isNewerVersion('1.0.1', '1.0')).toBe(false);
    });

    it('should handle four-part versions', () => {
      expect(isNewerVersion('1.0.0.0', '1.0.0.1')).toBe(true);
      expect(isNewerVersion('1.0.0.1', '1.0.0.0')).toBe(false);
    });

    it('should treat missing parts as zero', () => {
      expect(isNewerVersion('1.0', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '1.0')).toBe(false);
    });
  });

  describe('pre-release version handling', () => {
    it('should consider stable newer than pre-release with same base', () => {
      expect(isNewerVersion('1.0.0-alpha', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.0.0-beta.1', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(true);
    });

    it('should consider pre-release older than stable with same base', () => {
      expect(isNewerVersion('1.0.0', '1.0.0-alpha')).toBe(false);
      expect(isNewerVersion('1.0.0', '1.0.0-beta.1')).toBe(false);
    });

    it('should strip pre-release tags for base comparison', () => {
      expect(isNewerVersion('1.0.0-alpha', '1.1.0-alpha')).toBe(true);
      expect(isNewerVersion('1.0.0-alpha', '2.0.0-beta')).toBe(true);
    });

    it('should handle complex pre-release tags', () => {
      expect(isNewerVersion('1.0.0-alpha.0', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.0.0-beta.2.3', '1.0.0')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle large version numbers', () => {
      expect(isNewerVersion('100.200.300', '100.200.301')).toBe(true);
      expect(isNewerVersion('999.999.999', '1000.0.0')).toBe(true);
    });

    it('should handle version 0.x.x correctly', () => {
      expect(isNewerVersion('0.0.1', '0.0.2')).toBe(true);
      expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true);
      expect(isNewerVersion('0.9.9', '1.0.0')).toBe(true);
    });

    it('should throw for invalid version format', () => {
      expect(() => isNewerVersion('invalid', '1.0.0')).toThrow('Invalid version format');
      expect(() => isNewerVersion('1.0.0', 'invalid')).toThrow('Invalid version format');
      expect(() => isNewerVersion('1.a.0', '1.0.0')).toThrow('Invalid version format');
      expect(() => isNewerVersion('1..0', '1.0.0')).toThrow('Invalid version format');
    });

    it('should reject versions with unstripped "v" prefix', () => {
      // isNewerVersion expects pre-stripped versions; callers must remove leading "v".
      expect(() => isNewerVersion('v1.0.0', '1.0.0')).toThrow('Invalid version format');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle npm-style version bumps', () => {
      // Patch bump
      expect(isNewerVersion('0.1.5', '0.1.6')).toBe(true);
      // Minor bump
      expect(isNewerVersion('0.1.6', '0.2.0')).toBe(true);
      // Major bump
      expect(isNewerVersion('0.9.9', '1.0.0')).toBe(true);
    });

    it('should handle movehat version progression', () => {
      expect(isNewerVersion('0.0.1', '0.1.0')).toBe(true);
      expect(isNewerVersion('0.1.0', '0.1.1')).toBe(true);
      expect(isNewerVersion('0.1.9', '0.1.10')).toBe(true);
    });
  });
});
