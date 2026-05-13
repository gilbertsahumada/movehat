// Export all helpers for end users
export * from "./helpers/index.js";
export type { MovehatConfig } from "./types/config.js";

// Export Movehat Runtime Environment
export { initRuntime, getMovehat } from "./runtime.js";
export type { MovehatRuntime, NetworkInfo } from "./types/runtime.js";

// Export Fork system
export { ForkManager } from "./fork/manager.js";
export { MovementApiClient } from "./fork/api.js";
export { ForkStorage } from "./fork/storage.js";
export { ForkServer } from "./fork/server.js";
export type { ForkMetadata, AccountState, LedgerInfo, AccountData, AccountResource } from "./types/fork.js";

// Export custom errors
export { ModuleAlreadyDeployedError, PostPublishError } from "./errors.js";

// Export Harness (Hardhat-style API — primary public surface from M2 onward)
export { Harness, HarnessDisposedError } from "./harness/index.js";
export type { HarnessMode } from "./harness/index.js";