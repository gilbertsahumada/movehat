import {
  generateSignedTransaction,
  type AccountAuthenticator,
  type AnyRawTransaction,
} from "@aptos-labs/ts-sdk";

import type { TraceResponse } from "./types.js";

/** Content type movelite requires for BCS-signed transaction bodies. */
const BCS_SIGNED_TXN_CONTENT_TYPE = "application/x.aptos.signed_transaction+bcs";

/**
 * Pull a readable detail out of a movelite error body. movelite (>= 0.2.1)
 * returns structured JSON errors (`{ message, error_code, vm_error_code }`);
 * older versions return plain text. Returns the `message` plus any codes when
 * the body is JSON, otherwise the raw text unchanged.
 */
function extractErrorDetail(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as {
      message?: unknown;
      error_code?: unknown;
      vm_error_code?: unknown;
    };
    if (parsed && typeof parsed.message === "string") {
      const codes = [parsed.error_code, parsed.vm_error_code].filter(
        (c) => c !== undefined && c !== null
      );
      return codes.length > 0
        ? `${parsed.message} (${codes.join(", ")})`
        : parsed.message;
    }
  } catch {
    // Not JSON (e.g. older movelite plain-text errors) — fall through.
  }
  return body;
}

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
    const detail = extractErrorDetail(body);
    throw new Error(
      `movelite trace request failed (${res.status} ${res.statusText})` +
        (detail ? `: ${detail}` : "")
    );
  }

  const response = (await res.json()) as TraceResponse;
  return { response, elapsedMs };
}
