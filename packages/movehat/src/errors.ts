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

/**
 * Thrown by runCli when a spawned process exits with a non-zero status.
 *
 * `stderr` and `stdoutPreview` are already redacted of well-known secret
 * shapes (private keys, etc.) by the caller before construction, so the error
 * is safe to log.
 */
export class CliExecutionError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly args: readonly string[],
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdoutPreview: string
  ) {
    super(message);
    this.name = 'CliExecutionError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CliExecutionError);
    }
  }
}
