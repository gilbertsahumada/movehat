// Re-export all helpers
export { setupTestEnvironment, createTestAccount } from "./setup.js";
export type { TestEnvironment } from "./setup.js";
export { MoveContract, getContract } from "../core/contract.js";
export type { TransactionResult } from "../core/contract.js";
export {
  assertTransactionSuccess,
  assertTransactionFailed,
} from "./assertions.js";
export {
  saveDeployment,
  loadDeployment,
  getAllDeployments,
  getDeployedAddress,
} from "../core/deployments.js";
export type { DeploymentInfo } from "../core/deployments.js";
export {
  snapshot,
  getForkInfo,
  viewForkResource,
  compareForkState,
  listSnapshots,
} from "../fork/test.js";
export type { SnapshotOptions, ForkInfo } from "../fork/test.js";
export { AccountManager } from "../core/AccountManager.js";
export type { StoredAccount } from "../core/AccountManager.js";
export {
  setupLocalTesting,
  stopLocalTesting,
  getCurrentForkManager,
  resetForkState,
} from "./setupLocalTesting.js";
export {
  setupTestFixture,
  teardownTestFixture,
  setupMinimalFixture,
} from "./testFixtures.js";
export type { TestFixture } from "./testFixtures.js";

export type { MovehatConfig, LocalTestOptions } from "../types/config.js";