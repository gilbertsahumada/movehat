import { describe, it, expect } from 'vitest';
import {
  isHexAddress,
  normalizeAddress,
  normalizeAddressShort,
} from '../address.js';

const PADDED_ONE = '0x' + '0'.repeat(63) + '1';
const PADDED_DEAD = '0x' + '0'.repeat(60) + 'dead';

describe('normalizeAddress', () => {
  it('pads a short hex to 64 chars and adds 0x', () => {
    expect(normalizeAddress('1')).toBe(PADDED_ONE);
  });

  it('preserves a fully padded address', () => {
    const full = '0x' + 'a'.repeat(64);
    expect(normalizeAddress(full)).toBe(full);
  });

  it('lowercases mixed-case input', () => {
    expect(normalizeAddress('0xDEAD')).toBe(PADDED_DEAD);
  });

  it('adds the 0x prefix when missing', () => {
    expect(normalizeAddress('dead')).toBe(PADDED_DEAD);
  });

  it('returns 0x followed by 64 zeros for empty input', () => {
    expect(normalizeAddress('')).toBe('0x' + '0'.repeat(64));
  });

  it('matches fork/manager.ts legacy semantics for the canonical case', () => {
    // Mirrors the inline `private normalizeAddress` from fork/manager.ts:243.
    expect(normalizeAddress('0X1')).toBe(PADDED_ONE);
  });
});

describe('normalizeAddressShort', () => {
  it('adds 0x and lowercases without padding', () => {
    expect(normalizeAddressShort('DEAD')).toBe('0xdead');
  });

  it('preserves the 0x prefix when already present', () => {
    expect(normalizeAddressShort('0xBeef')).toBe('0xbeef');
  });

  it('does not pad a short address', () => {
    expect(normalizeAddressShort('1')).toBe('0x1');
  });

  it('returns just 0x for empty input', () => {
    expect(normalizeAddressShort('')).toBe('0x');
  });
});

describe('isHexAddress', () => {
  it('accepts short hex with 0x prefix', () => {
    expect(isHexAddress('0x1')).toBe(true);
  });

  it('accepts hex without 0x prefix', () => {
    expect(isHexAddress('dead')).toBe(true);
  });

  it('accepts uppercase 0X prefix', () => {
    expect(isHexAddress('0Xabc')).toBe(true);
  });

  it('accepts a full 64-char address', () => {
    expect(isHexAddress('0x' + 'f'.repeat(64))).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isHexAddress('')).toBe(false);
  });

  it('rejects lone 0x with no hex', () => {
    expect(isHexAddress('0x')).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(isHexAddress('0xghij')).toBe(false);
  });

  it('rejects input longer than 64 hex chars', () => {
    expect(isHexAddress('0x' + '0'.repeat(65))).toBe(false);
  });

  it('accepts mixed case hex', () => {
    expect(isHexAddress('0xAbCdEf')).toBe(true);
  });
});
