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

function hasString(o: Record<string, unknown>, key: string): boolean {
  return typeof o[key] === "string";
}

export function assertLedgerInfo(v: unknown): LedgerInfo {
  if (
    !isObject(v) ||
    typeof v.chain_id !== "number" ||
    !hasString(v, "epoch") ||
    !hasString(v, "ledger_version") ||
    !hasString(v, "oldest_ledger_version") ||
    !hasString(v, "ledger_timestamp") ||
    !hasString(v, "node_role") ||
    !hasString(v, "oldest_block_height") ||
    !hasString(v, "block_height")
  ) {
    throw new Error("Invalid LedgerInfo: missing or incorrectly typed fields");
  }
  return v as unknown as LedgerInfo;
}

export function assertAccountData(v: unknown): AccountData {
  if (
    !isObject(v) ||
    !hasString(v, "sequence_number") ||
    !hasString(v, "authentication_key")
  ) {
    throw new Error(
      "Invalid AccountData: expected object with 'sequence_number' and 'authentication_key' strings"
    );
  }
  return v as unknown as AccountData;
}

export function assertAccountResource(v: unknown): AccountResource {
  if (!isObject(v) || !hasString(v, "type") || !("data" in v)) {
    throw new Error(
      "Invalid AccountResource: expected object with 'type' string and 'data' field"
    );
  }
  return v as unknown as AccountResource;
}

export function assertAccountResourceArray(v: unknown): AccountResource[] {
  if (!Array.isArray(v)) {
    throw new Error("Invalid resources response: expected array");
  }
  for (let i = 0; i < v.length; i++) {
    if (!isObject(v[i]) || !hasString(v[i], "type") || !("data" in v[i])) {
      throw new Error(
        `Invalid AccountResource at index ${i}: expected object with 'type' and 'data'`
      );
    }
  }
  return v as unknown as AccountResource[];
}

export function assertForkMetadata(v: unknown): ForkMetadata {
  if (
    !isObject(v) ||
    !hasString(v, "network") ||
    !hasString(v, "nodeUrl") ||
    typeof v.chainId !== "number" ||
    !hasString(v, "ledgerVersion") ||
    !hasString(v, "timestamp") ||
    !hasString(v, "epoch") ||
    !hasString(v, "blockHeight") ||
    !hasString(v, "createdAt")
  ) {
    throw new Error("Invalid ForkMetadata: missing or incorrectly typed fields");
  }
  return v as unknown as ForkMetadata;
}

export function assertAccountState(v: unknown): AccountState {
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
  if (
    !isObject(v) ||
    !isObject(v.coin) ||
    !hasString(v.coin as Record<string, unknown>, "value")
  ) {
    throw new Error(
      "Invalid CoinStore: expected object with 'coin.value' string"
    );
  }
  return v as unknown as CoinStore;
}
