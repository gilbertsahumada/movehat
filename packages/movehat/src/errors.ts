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
