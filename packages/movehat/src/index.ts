// Export all helpers for end users
export * from "./helpers/index.js";
export type { MovehatConfig } from "./types/config.js";

// Export Movehat Runtime Environment.
// `getMovehat` is @deprecated as of M2.4 — see runtime.ts JSDoc. Use
// the Harness.create* factories below for new code.
// `initRuntime` stays as a public utility but external callers should
// prefer Harness; it's the construction primitive Harness.createLive uses.
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