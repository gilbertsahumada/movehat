/**
 * Helpers for extracting fields out of Movement CLI stdout / stderr.
 *
 * @internal — not exported from `src/index.ts`.
 */

import { logger } from '../ui/index.js';

/**
 * Extract the transaction hash from a `movement` CLI subcommand's stdout.
 *
 * Two context-bearing shapes are accepted, checked in order:
 *
 *   1. JSON `Result` block: `"transaction_hash": "0x…"` — what the CLI
 *      emits for `run-script` today. (`deploy-object` / `upgrade-object`
 *      print no hash in any shape — callers treat txHash as optional.)
 *   2. Free text: `transaction hash: 0x…`, `txn hash: 0x…`, `hash: 0x…`.
 *
 * When neither context is present we log a warning and return
 * `undefined` so callers decide whether to throw — a loose "any 64-hex
 * literal" fallback would be fragile: a padded module address or state
 * root printed before the actual txhash would silently corrupt the
 * cached deployment record.
 *
 * Shared by `core/Publisher.ts` (publish), `harness/codeObject.ts`
 * (deploy-object / upgrade-object), and `harness/script.ts`
 * (run-script). All three CLI subcommands emit the txHash in the same
 * shape — keep this helper as the single source of truth so a future
 * CLI-format change is a one-line fix.
 */
export function parseTxHash(stdout: string): string | undefined {
  const jsonShape = stdout.match(
    /"transaction_hash"\s*:\s*"(0x[a-fA-F0-9]{64})"/
  );
  if (jsonShape?.[1]) return jsonShape[1];
  const withContext = stdout.match(
    /(?:transaction\s*(?:hash)?|txn\s*(?:hash)?|hash):\s*(0x[a-fA-F0-9]{64})\b/i
  );
  if (withContext?.[1]) return withContext[1];
  logger.warning(
    `parseTxHash: no contextual 'transaction_hash' JSON field or 'transaction|txn|hash: 0x…' match in ${stdout.length}-byte CLI output. ` +
      `Returning undefined; the caller decides whether to error.`
  );
  return undefined;
}
