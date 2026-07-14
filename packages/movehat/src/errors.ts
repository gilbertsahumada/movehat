/**
 * Custom error thrown when attempting to deploy a module that is already deployed
 */
export class ModuleAlreadyDeployedError extends Error {
  constructor(
    message: string,
    public readonly moduleName: string,
    public readonly network: string,
    public readonly address: string,
    public readonly timestamp: number,
    public readonly txHash?: string
  ) {
    super(message);
    this.name = 'ModuleAlreadyDeployedError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ModuleAlreadyDeployedError);
    }
  }
}

import { redactSecrets } from './utils/redact.js';
import type { DeploymentInfo } from './core/deployments.js';

/**
 * Thrown when the on-chain publish succeeded but a subsequent local
 * step (saveDeployment, profile cleanup, etc.) failed.
 *
 * Distinct from `CliExecutionError`: by the time this error fires, the
 * module IS deployed on-chain. Callers that want to recover can read
 * `deployment` and re-attempt the local-side persistence manually
 * (e.g. write the JSON to `deployments/{network}/{moduleName}.json`).
 *
 * Without this distinction, the same outer catch would surface a
 * post-publish filesystem failure as "Failed to publish module",
 * inviting an accidental redeploy that wastes gas.
 */
export class PostPublishError extends Error {
  constructor(
    message: string,
    public readonly deployment: DeploymentInfo,
    public readonly cause: Error
  ) {
    super(message);
    this.name = 'PostPublishError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PostPublishError);
    }
  }
}

/**
 * Thrown by runCli when a spawned process exits with a non-zero status.
 *
 * `stderr`, `stdoutPreview`, and each entry in `args` are redacted of
 * well-known secret shapes (private keys, etc.) in the constructor, so the
 * error is safe to log regardless of how it was raised. Redaction is
 * idempotent.
 */
export class CliExecutionError extends Error {
  public readonly args: readonly string[];

  constructor(
    message: string,
    public readonly command: string,
    args: readonly string[],
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdoutPreview: string
  ) {
    super(message);
    this.name = 'CliExecutionError';
    this.args = args.map(redactSecrets);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CliExecutionError);
    }
  }
}

/**
 * Thrown before runtime construction when two explicit network selectors
 * disagree. `MH_CLI_NETWORK` is set by the `--network` CLI flag, so silently
 * letting an API argument override it could submit a transaction to a network
 * different from the one shown in the command invocation.
 */
export class NetworkConflictError extends Error {
  constructor(
    public readonly apiNetwork: string,
    public readonly cliNetwork: string
  ) {
    super(
      `Conflicting network selection: API requested '${apiNetwork}' but ` +
        `--network selected '${cliNetwork}'. Remove one selector or make them match.`
    );
    this.name = "NetworkConflictError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NetworkConflictError);
    }
  }
}

/**
 * Thrown before a recursive filesystem operation targets a path that Movehat
 * cannot prove it owns.
 */
export class UnsafePathError extends Error {
  constructor(
    message: string,
    public readonly path: string
  ) {
    super(message);
    this.name = "UnsafePathError";

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UnsafePathError);
    }
  }
}
