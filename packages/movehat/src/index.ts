// Export all helpers for end users
export * from "./helpers/index.js";
export type {
  MovehatConfig,
  MovehatUserConfig,
  NetworkConfig,
  LocalTestingMode,
} from "./types/config.js";

// Movehat Runtime Environment. `initRuntime` is a public utility but
// external callers should prefer Harness; it's the construction primitive
// `Harness.createLive` uses.
export { initRuntime } from "./runtime.js";
export type { InitRuntimeOptions } from "./runtime.js";
export type { MovehatRuntime, NetworkInfo } from "./types/runtime.js";

// Re-export the ChildProcessAdapter interface so end-users can supply
// a custom adapter (e.g. sandboxed CLI execution in tests).
export type {
  ChildProcessAdapter,
  ChildProcessEnvironment,
  ChildProcessSignal,
  RunInput,
  RunResult,
  SpawnInput,
  SpawnedProcess,
} from "./utils/childProcessAdapter.js";

// Export Fork system
export { ForkManager } from "./fork/manager.js";
export { MovementApiClient } from "./fork/api.js";
export type { MovementApiClientOptions } from "./fork/api.js";
export { ForkStorage } from "./fork/storage.js";
export { ForkServer } from "./fork/server.js";
export {
  MovementApiError,
  ForkDataNotFoundError,
  ForkSnapshotChangedError,
  ForkSnapshotPrunedError,
} from "./fork/errors.js";
export type { MovementApiErrorCode } from "./fork/errors.js";
export type { ForkInitializeOptions } from "./fork/manager.js";
export type { ForkServerOptions } from "./fork/server.js";
export type { ForkMetadata, AccountState, LedgerInfo, AccountData, AccountResource } from "./types/fork.js";

// Export custom errors
export {
  ModuleAlreadyDeployedError,
  PostPublishError,
  NetworkConflictError,
  UnsafePathError,
  TransactionOutcomeUnknownError,
} from "./errors.js";
export { InvalidPersistedStateError } from "./core/deployments.js";
export type { DeploymentInfo } from "./core/deployments.js";

export { Harness, HarnessDisposedError } from "./harness/index.js";
export type { HarnessMode } from "./harness/index.js";
export type {
  DeployCodeObjectOptions,
  UpgradeCodeObjectOptions,
  CodeObjectInfo,
  RunViewFunctionOptions,
  RunMoveScriptOptions,
  MoveScriptResult,
  CreateForkOptions,
} from "./types/harness.js";
