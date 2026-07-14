import type {
  LedgerInfo,
  AccountData,
  AccountResource,
  ForkMetadata,
  AccountState,
  CoinStore,
} from "../types/fork.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// `__proto__` has setter semantics on ordinary objects and must never flow
// from persisted/upstream JSON into our address/resource lookup records.
const UNSAFE_OBJECT_KEYS = new Set(["__proto__"]);

export function assertSafeJsonValue(v: unknown, path: string = "$"): void {
  if (Array.isArray(v)) {
    v.forEach((item, index) => assertSafeJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(v)) return;
  const prototype = Object.getPrototypeOf(v);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Unsafe object prototype at ${path}`);
  }
  for (const [key, value] of Object.entries(v)) {
    if (UNSAFE_OBJECT_KEYS.has(key)) {
      throw new Error(`Unsafe object key "${key}" at ${path}`);
    }
    assertSafeJsonValue(value, `${path}.${key}`);
  }
}

export function assertSafeRecordKey(key: string, label: string): void {
  if (UNSAFE_OBJECT_KEYS.has(key)) {
    throw new Error(`Unsafe ${label}: "${key}" is not allowed`);
  }
}

function hasString(o: Record<string, unknown>, key: string): boolean {
  return typeof o[key] === "string";
}

function hasUnsignedIntegerString(o: Record<string, unknown>, key: string): boolean {
  return hasString(o, key) && /^\d+$/.test(o[key] as string);
}

export function assertLedgerInfo(v: unknown): LedgerInfo {
  assertSafeJsonValue(v);
  if (
    !isObject(v) ||
    !Number.isSafeInteger(v.chain_id) ||
    (v.chain_id as number) < 0 ||
    !hasUnsignedIntegerString(v, "epoch") ||
    !hasUnsignedIntegerString(v, "ledger_version") ||
    !hasUnsignedIntegerString(v, "oldest_ledger_version") ||
    !hasUnsignedIntegerString(v, "ledger_timestamp") ||
    !hasString(v, "node_role") ||
    !hasUnsignedIntegerString(v, "oldest_block_height") ||
    !hasUnsignedIntegerString(v, "block_height")
  ) {
    throw new Error("Invalid LedgerInfo: missing or incorrectly typed fields");
  }
  return v as unknown as LedgerInfo;
}

export function assertAccountData(v: unknown): AccountData {
  assertSafeJsonValue(v);
  if (
    !isObject(v) ||
    !hasUnsignedIntegerString(v, "sequence_number") ||
    !hasString(v, "authentication_key")
  ) {
    throw new Error(
      "Invalid AccountData: expected object with 'sequence_number' and 'authentication_key' strings"
    );
  }
  return v as unknown as AccountData;
}

export function assertAccountResource(v: unknown): AccountResource {
  assertSafeJsonValue(v);
  if (!isObject(v) || !hasString(v, "type") || !("data" in v)) {
    throw new Error(
      "Invalid AccountResource: expected object with 'type' string and 'data' field"
    );
  }
  assertSafeRecordKey(v.type as string, "resource type");
  return v as unknown as AccountResource;
}

export function assertAccountResourceArray(v: unknown): AccountResource[] {
  assertSafeJsonValue(v);
  if (!Array.isArray(v)) {
    throw new Error("Invalid resources response: expected array");
  }
  for (let i = 0; i < v.length; i++) {
    if (!isObject(v[i]) || !hasString(v[i], "type") || !("data" in v[i])) {
      throw new Error(
        `Invalid AccountResource at index ${i}: expected object with 'type' and 'data'`
      );
    }
    assertSafeRecordKey(v[i].type as string, "resource type");
  }
  return v as unknown as AccountResource[];
}

export function assertForkMetadata(v: unknown): ForkMetadata {
  assertSafeJsonValue(v);
  if (
    !isObject(v) ||
    !hasString(v, "network") ||
    !hasString(v, "nodeUrl") ||
    !Number.isSafeInteger(v.chainId) ||
    (v.chainId as number) < 0 ||
    !hasUnsignedIntegerString(v, "ledgerVersion") ||
    !hasUnsignedIntegerString(v, "timestamp") ||
    !hasUnsignedIntegerString(v, "epoch") ||
    !hasUnsignedIntegerString(v, "blockHeight") ||
    !hasString(v, "createdAt") ||
    (v.schemaVersion !== undefined && v.schemaVersion !== 1)
  ) {
    throw new Error("Invalid ForkMetadata: missing or incorrectly typed fields");
  }
  return v as unknown as ForkMetadata;
}

export function assertAccountState(v: unknown): AccountState {
  assertSafeJsonValue(v);
  if (
    !isObject(v) ||
    !hasString(v, "sequenceNumber") ||
    !hasString(v, "authenticationKey")
  ) {
    throw new Error(
      "Invalid AccountState: expected object with 'sequenceNumber' and 'authenticationKey' strings"
    );
  }
  return v as unknown as AccountState;
}

export function assertAccountStateRecord(
  v: unknown
): Record<string, AccountState> {
  assertSafeJsonValue(v);
  if (!isObject(v)) {
    throw new Error("Invalid account state record: expected object");
  }
  for (const [key, val] of Object.entries(v)) {
    if (
      !isObject(val) ||
      !hasString(val, "sequenceNumber") ||
      !hasString(val, "authenticationKey")
    ) {
      throw new Error(
        `Invalid AccountState for key "${key}": missing 'sequenceNumber' or 'authenticationKey'`
      );
    }
  }
  return v as unknown as Record<string, AccountState>;
}

export function assertCoinStore(v: unknown): CoinStore {
  assertSafeJsonValue(v);
  if (
    !isObject(v) ||
    !isObject(v.coin) ||
    !hasString(v.coin as Record<string, unknown>, "value") ||
    !/^\d+$/.test((v.coin as Record<string, unknown>).value as string)
  ) {
    throw new Error(
      "Invalid CoinStore: expected object with 'coin.value' string"
    );
  }
  return v as unknown as CoinStore;
}

export function assertViewResponse(v: unknown): unknown[] {
  assertSafeJsonValue(v);
  if (!Array.isArray(v)) {
    throw new Error("Invalid view response: expected array");
  }
  return v;
}
