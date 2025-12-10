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

export interface ResourceData {
  type: string;
  data: any;
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
  data: any;
}
