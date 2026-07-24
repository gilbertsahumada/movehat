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
export type {
  AccountManagerOptions,
  SaveAccountPoolOptions,
  StoredAccount,
} from "../core/AccountManager.js";
export { LocalNodeManager } from "../node/LocalNodeManager.js";
export type { LocalNodeOptions, LocalNodeInfo } from "../node/LocalNodeManager.js";
export { MoveliteManager, findMoveliteBinary } from "../node/MoveliteManager.js";
export type { NodeProvider } from "../node/NodeProvider.js";
export { ForkManager } from "../fork/manager.js";
export type { ForkInitializeOptions } from "../fork/manager.js";
export { ForkServer } from "../fork/server.js";
export type { ForkServerOptions } from "../fork/server.js";
export type {
  AccountData,
  AccountResource,
  AccountState,
  ForkMetadata,
  LedgerInfo,
} from "../types/fork.js";
export { setupLocalTesting } from "./setupLocalTesting.js";
export type { LocalTestingContext } from "./setupLocalTesting.js";
export {
  setupTestFixture,
  setupMinimalFixture,
} from "./testFixtures.js";
export type { TestFixture } from "./testFixtures.js";
export { normalizeAddress, isHexAddress } from "../utils/address.js";

export type {
  LocalTestingMode,
  MovehatConfig,
  LocalTestOptions,
  NetworkConfig,
} from "../types/config.js";
export type { MovehatRuntime, NetworkInfo } from "../types/runtime.js";
export type {
  ChildProcessAdapter,
  ChildProcessEnvironment,
  ChildProcessSignal,
  RunInput,
  RunResult,
  SpawnInput,
  SpawnedProcess,
} from "../utils/childProcessAdapter.js";
