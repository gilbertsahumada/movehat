import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseTxHash } from '../parseCliOutput.js';

// Real-world-ish hashes — distinct values so the "wrong-fallback" trap
// is visible if anyone re-introduces the loose regex.
const REAL_TX_HASH = '0x' + 'a'.repeat(64);
const TRAP_HASH = '0x' + 'b'.repeat(64); // padded module address, state root, etc.

describe('parseTxHash (regression: #51)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Logger uses console.warn under the hood (see ui/logger.ts:139).
    // Spy at the console level so the assertion is decoupled from logger
    // formatting choices.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('extracts hash from the context-bearing pattern (transaction hash: 0x…)', () => {
    const stdout = `Some prelude line\nTransaction hash: ${REAL_TX_HASH}\nMore output`;
    expect(parseTxHash(stdout)).toBe(REAL_TX_HASH);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('extracts hash from "txn hash:" and "hash:" variants too', () => {
    expect(parseTxHash(`txn hash: ${REAL_TX_HASH}`)).toBe(REAL_TX_HASH);
    expect(parseTxHash(`hash: ${REAL_TX_HASH}`)).toBe(REAL_TX_HASH);
  });

  it('does NOT match a loose 64-hex literal — returns undefined + warns (the #51 trap)', () => {
    // Stdout printed by Movement CLI with a 64-hex token (e.g. a padded
    // module address, state root) BEFORE the actual txhash. Pre-#51 this
    // returned TRAP_HASH silently; post-fix it returns undefined and the
    // caller decides whether to error.
    const stdout = `Module address: ${TRAP_HASH}\nDeploying...\n(no Transaction hash line)`;
    expect(parseTxHash(stdout)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]!.join(' ')).toContain('no contextual');
  });

  it('prefers the context-bearing hash when a trap hash appears first', () => {
    // Critical: when both forms appear, the context-bearing one wins.
    // The loose-regex fallback (now removed) would have returned TRAP_HASH
    // because it was the first match in the stdout buffer.
    const stdout = `Module address: ${TRAP_HASH}\nTransaction hash: ${REAL_TX_HASH}`;
    expect(parseTxHash(stdout)).toBe(REAL_TX_HASH);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns undefined + warns on empty stdout', () => {
    expect(parseTxHash('')).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive on the context keyword', () => {
    expect(parseTxHash(`TRANSACTION HASH: ${REAL_TX_HASH}`)).toBe(REAL_TX_HASH);
    expect(parseTxHash(`Hash: ${REAL_TX_HASH}`)).toBe(REAL_TX_HASH);
  });
});
