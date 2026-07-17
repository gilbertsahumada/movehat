// Export all helpers for end users
export * from "./helpers/index.js";
export type {
  MovehatConfig,
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
export type { ChildProcessAdapter } from "./utils/childProcessAdapter.js";

// Export Fork system
export { ForkManager } from "./fork/manager.js";
export { MovementApiClient } from "./fork/api.js";
export { ForkStorage } from "./fork/storage.js";
export { ForkServer } from "./fork/server.js";
export type { ForkMetadata, AccountState, LedgerInfo, AccountData, AccountResource } from "./types/fork.js";

// Export custom errors
export {
  ModuleAlreadyDeployedError,
  PostPublishError,
  NetworkConflictError,
  UnsafePathError,
} from "./errors.js";

export { Harness, HarnessDisposedError } from "./harness/index.js";
export type { HarnessMode } from "./harness/index.js";
export type {
  DeployCodeObjectOptions,
  UpgradeCodeObjectOptions,
  CodeObjectInfo,
  RunViewFunctionOptions,
  RunMoveScriptOptions,
  MoveScriptResult,
} from "./types/harness.js";
