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

  it("extracts hash from the CLI's JSON Result block (regression: #363)", () => {
    // Verbatim shape of `movement move run-script` / `deploy-object`
    // output from the current CLI. Neither free-text pattern matches it:
    // the underscore breaks the "transaction hash" context and the
    // quoted value breaks ":\\s*0x".
    const stdout = `{
  "Result": {
    "transaction_hash": "${REAL_TX_HASH}",
    "gas_used": 3,
    "gas_unit_price": 100,
    "sender": "828a0c3d3b456381db210daf69f90ef3e2683b74fd7a8cb4ece9b7deab6c1fe3",
    "sequence_number": 2,
    "success": true,
    "timestamp_us": 1783701141094452,
    "version": 43,
    "vm_status": "Executed successfully"
  }
}`;
    expect(parseTxHash(stdout)).toBe(REAL_TX_HASH);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('JSON shape wins even when a trap hash appears earlier in the output', () => {
    const stdout = `Module address: ${TRAP_HASH}\n{"Result": {"transaction_hash": "${REAL_TX_HASH}"}}`;
    expect(parseTxHash(stdout)).toBe(REAL_TX_HASH);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tolerates whitespace variations around the JSON separator', () => {
    expect(parseTxHash(`"transaction_hash":"${REAL_TX_HASH}"`)).toBe(REAL_TX_HASH);
    expect(parseTxHash(`"transaction_hash" : "${REAL_TX_HASH}"`)).toBe(REAL_TX_HASH);
  });

  it('does not match an unquoted or non-hash transaction_hash value', () => {
    expect(parseTxHash(`"transaction_hash": "not-a-hash"`)).toBeUndefined();
    expect(parseTxHash(`"transaction_hash": "0x1234"`)).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
