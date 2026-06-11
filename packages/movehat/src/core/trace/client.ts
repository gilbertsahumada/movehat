import {
  generateSignedTransaction,
  type AccountAuthenticator,
  type AnyRawTransaction,
} from "@aptos-labs/ts-sdk";

import type { TraceResponse } from "./types.js";

/** Content type movelite requires for BCS-signed transaction bodies. */
const BCS_SIGNED_TXN_CONTENT_TYPE = "application/x.aptos.signed_transaction+bcs";

/**
 * Execute a signed transaction through movelite's instrumented VM and return
 * the Foundry-style call tree. `commit=true` runs the trace AND commits in a
 * single pass, so this is the sole execution — the caller must NOT also submit.
 *
 * @param rpcUrl movelite RPC base, already ending in `/v1`.
 * @throws if the endpoint returns a non-2xx status (a submission failure).
 */
export async function traceTransaction(args: {
  rpcUrl: string;
  transaction: AnyRawTransaction;
  senderAuthenticator: AccountAuthenticator;
}): Promise<{ response: TraceResponse; elapsedMs: number }> {
  const { rpcUrl, transaction, senderAuthenticator } = args;

  const bytes = generateSignedTransaction({ transaction, senderAuthenticator });
  const url = `${rpcUrl}/transactions/trace?commit=true`;

  const start = performance.now();
  const res = await fetch(url, {
    method: "POST",
    // No Accept header (response is JSON); no auth header (movelite runs --no-auth).
    // Copy into a fresh ArrayBuffer-backed Uint8Array: the SDK returns
    // `Uint8Array<ArrayBufferLike>`, which the fetch `BodyInit` type rejects
    // under this TS lib config (the ArrayBuffer / SharedArrayBuffer split).
    headers: { "Content-Type": BCS_SIGNED_TXN_CONTENT_TYPE },
    body: new Uint8Array(bytes),
  });
  const elapsedMs = performance.now() - start;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `movelite trace request failed (${res.status} ${res.statusText})` +
        (body ? `: ${body}` : "")
    );
  }

  const response = (await res.json()) as TraceResponse;
  return { response, elapsedMs };
}
