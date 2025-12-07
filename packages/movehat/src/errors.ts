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
