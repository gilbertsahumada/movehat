/**
 * Patterns that match well-known secret shapes Movement tools emit on
 * stderr / stdout / CLI arguments. Each match is replaced with
 * `***REDACTED***` by `redactSecrets`.
 *
 * The labelled/contextual patterns intentionally accept bare `priv` and
 * `key` prefixes only when they are adjacent to a full 32-byte hex value.
 * Full-length addresses without key context are left untouched.
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\b[a-z0-9]+(?:-[a-z0-9]+)*-priv-0x[0-9a-fA-F]{64,}\b/gi,
  /(?:--)?(?:private[_-]?key|private\s+key|priv[_-]?key|priv|key)\s*(?:[:=]|\s)\s*0x[0-9a-fA-F]{64}\b/gi,
  /\b0x[0-9a-fA-F]{64}\b(?=\s*(?:private[_-]?key|private\s+key|priv[_-]?key|priv|key)\b)/gi,
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
