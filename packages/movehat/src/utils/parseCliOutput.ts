/**
 * Helpers for extracting fields out of Movement CLI stdout / stderr.
 *
 * @internal — not exported from `src/index.ts`.
 */

/**
 * Extract the transaction hash from a `movement` CLI subcommand's stdout.
 *
 * Tries the context-bearing pattern first (`transaction hash: 0x…`,
 * `txn hash: 0x…`, `hash: 0x…`) and falls back to any 64-char hex
 * literal in the buffer. Returns `undefined` if no candidate matches.
 *
 * Shared by `core/Publisher.ts` (publish), `harness/codeObject.ts`
 * (deploy-object / upgrade-object), and `harness/script.ts`
 * (run-script). All three CLI subcommands emit the txHash in the same
 * shape — keep this helper as the single source of truth so a future
 * CLI-format change is a one-line fix.
 */
export function parseTxHash(stdout: string): string | undefined {
  const withContext = stdout.match(
    /(?:transaction\s*(?:hash)?|txn\s*(?:hash)?|hash):\s*(0x[a-fA-F0-9]{64})\b/i
  );
  if (withContext?.[1]) return withContext[1];
  const fallback = stdout.match(/\b(0x[a-fA-F0-9]{64})\b/);
  return fallback?.[1];
}
