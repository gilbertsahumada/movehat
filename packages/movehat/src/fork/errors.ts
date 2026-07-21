export type MovementApiErrorCode =
  | 'http_error'
  | 'timeout'
  | 'response_too_large'
  | 'invalid_response'
  | 'network_error';

/** A typed, redacted failure at the Movement JSON API boundary. */
export class MovementApiError extends Error {
  readonly code: MovementApiErrorCode;
  readonly statusCode?: number;
  readonly upstreamErrorCode?: string;

  constructor(
    message: string,
    code: MovementApiErrorCode,
    options: {
      statusCode?: number;
      upstreamErrorCode?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MovementApiError';
    this.code = code;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options.upstreamErrorCode !== undefined) {
      this.upstreamErrorCode = options.upstreamErrorCode;
    }
  }
}

export class ForkDataNotFoundError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ForkDataNotFoundError';
  }
}

export class ForkSnapshotPrunedError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ForkSnapshotPrunedError';
  }
}

export const FORK_SNAPSHOT_PRUNED_GUIDANCE =
  'Recreate the fork at a fresh ledger version (CLI: run movehat fork create again and confirm overwrite; API: initialize with overwrite: true). resetState() only clears local cache and cannot restore a pruned upstream snapshot.';

export class ForkAlreadyExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForkAlreadyExistsError';
  }
}

export function isMovementApiHttpError(
  error: unknown,
  statusCode?: number
): error is MovementApiError {
  return (
    error instanceof MovementApiError &&
    error.code === 'http_error' &&
    (statusCode === undefined || error.statusCode === statusCode)
  );
}

export function isPrunedSnapshotError(error: unknown): error is MovementApiError {
  if (!(error instanceof MovementApiError) || error.code !== 'http_error') return false;
  if (error.statusCode === 410) return true;
  const code = error.upstreamErrorCode?.toLowerCase();
  return code === 'version_pruned' || code === 'ledger_version_pruned';
}
