/**
 * Patterns that match well-known secret shapes Movement tools emit on
 * stderr / stdout / CLI arguments. Each match is replaced with
 * `***REDACTED***` by `redactSecrets`.
 *
 * The labelled pattern (second entry) intentionally accepts bare `priv` and
 * `key` prefixes. Over-redaction is fine; missing a real key is not.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /ed25519-priv-0x[0-9a-fA-F]{64}/g,
  /(private[_-]?key|priv[_-]?key|priv|key)\s*[:=]\s*0x[0-9a-fA-F]{32,}/gi,
];

/**
 * Replaces every match of every known secret pattern with `***REDACTED***`.
 * Idempotent: running it on already-redacted text is a no-op.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '***REDACTED***');
  }
  return out;
}
