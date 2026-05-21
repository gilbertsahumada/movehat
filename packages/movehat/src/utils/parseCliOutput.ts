/**
 * Helpers for extracting fields out of Movement CLI stdout / stderr.
 *
 * @internal — not exported from `src/index.ts`.
 */

import { logger } from '../ui/index.js';

/**
 * Extract the transaction hash from a `movement` CLI subcommand's stdout.
 *
 * Only the context-bearing pattern is accepted (`transaction hash: 0x…`,
 * `txn hash: 0x…`, `hash: 0x…`). When the context is absent we log a
 * warning and return `undefined` so callers decide whether to throw —
 * the previous behavior of falling back to "any 64-hex literal" was
 * fragile: a padded module address or state root printed before the
 * actual txhash would silently corrupt the cached deployment record.
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
  logger.warning(
    `parseTxHash: no contextual 'transaction|txn|hash: 0x…' match in ${stdout.length}-byte CLI output. ` +
      `Returning undefined; the caller decides whether to error.`
  );
  return undefined;
}
