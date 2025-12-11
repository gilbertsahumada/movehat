import { type TransactionResult } from "../core/contract.js";

/**
 * Assert that a transaction was successful
 */
export function assertTransactionSuccess(result: TransactionResult): void {
  if (!result.success) {
    throw new Error(
      `Transaction failed with status: ${result.vm_status}\nHash: ${result.hash}`
    );
  }
}

export function assertTransactionFailed(
  result: TransactionResult,
  expectedError?: string
): void {
  if (result.success) {
    throw new Error(
      `Transaction was expected to fail but succeeded.\nHash: ${result.hash}`
    );
  }

  if(expectedError && !result.vm_status.includes(expectedError)) {
    throw new Error(
      `Transaction failed with unexpected error.\nExpected to include: ${expectedError}\nActual status: ${result.vm_status}\nHash: ${result.hash}`
    );
  }
}
