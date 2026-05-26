/**
 * Fork system types for MoveHat
 */

export interface ForkMetadata {
  network: string;
  nodeUrl: string;
  chainId: number;
  ledgerVersion: string;
  timestamp: string;
  epoch: string;
  blockHeight: string;
  createdAt: string;
}

export interface AccountState {
  sequenceNumber: string;
  authenticationKey: string;
}

export interface LedgerInfo {
  chain_id: number;
  epoch: string;
  ledger_version: string;
  oldest_ledger_version: string;
  ledger_timestamp: string;
  node_role: string;
  oldest_block_height: string;
  block_height: string;
  git_hash?: string;
}

export interface AccountData {
  sequence_number: string;
  authentication_key: string;
}

export interface AccountResource {
  type: string;
  /**
   * Move resource payload — structurally a JSON-shaped object whose
   * schema depends on the resource type (CoinStore, AggregatorSnapshot, etc).
   * unknown forces callers to narrow before access; the boundary-validation
   * follow-up of #57 will add per-resource type guards.
   */
  data: unknown;
}

export interface CoinStore {
  coin: { value: string };
  deposit_events: {
    counter: string;
    guid: { id: { addr: string; creation_num: string } };
  };
  withdraw_events: {
    counter: string;
    guid: { id: { addr: string; creation_num: string } };
  };
  frozen: boolean;
}
