/**
 * Address normalization helpers shared across the fork code.
 *
 * Two normalization variants live in production today and are preserved here
 * with identical semantics so the in-place migration in M1.2 is behavior-
 * preserving:
 *
 *   - `normalizeAddress`      → lowercase + `0x` + left-pad to 64 hex chars.
 *                                Used by `fork/manager.ts` for storage keys.
 *   - `normalizeAddressShort` → lowercase + `0x`, no padding.
 *                                Used by `fork/api.ts` for HTTP paths.
 */

/**
 * Lowercase the input, ensure a `0x` prefix, and left-pad the hex tail to
 * 64 characters (66 total). Already-padded inputs are returned unchanged
 * (apart from case folding).
 *
 * No validation: callers that need to reject non-hex input should consult
 * `isHexAddress` first.
 */
export function normalizeAddress(input: string): string {
  let normalized = input.toLowerCase();

  if (!normalized.startsWith('0x')) {
    normalized = `0x${normalized}`;
  }

  if (normalized.length < 66) {
    normalized = '0x' + normalized.slice(2).padStart(64, '0');
  }

  return normalized;
}

/**
 * Lowercase the input and ensure a `0x` prefix. Length is preserved — no
 * padding is applied. Suitable for callers that pass addresses straight to
 * an HTTP endpoint that accepts short forms.
 */
export function normalizeAddressShort(input: string): string {
  const lower = input.toLowerCase();
  return lower.startsWith('0x') ? lower : `0x${lower}`;
}

/**
 * Returns true when the input is a syntactically valid hex address: optional
 * `0x` prefix followed by 1 to 64 hex characters (case insensitive).
 */
export function isHexAddress(input: string): boolean {
  const stripped = input.startsWith('0x') || input.startsWith('0X')
    ? input.slice(2)
    : input;
  if (stripped.length === 0 || stripped.length > 64) return false;
  return /^[0-9a-fA-F]+$/.test(stripped);
}
