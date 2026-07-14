export type MovementApiErrorCode =
  | 'http_error'
  | 'timeout'
  | 'response_too_large'
  | 'invalid_response'
  | 'network_error';

/** A typed failure at the Movement JSON API boundary. */
export class MovementApiError extends Error {
  readonly code: MovementApiErrorCode;
  readonly statusCode?: number;

  constructor(
    message: string,
    code: MovementApiErrorCode,
    options: { statusCode?: number; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MovementApiError';
    this.code = code;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
  }
}

/** A remote 404 translated into a fork-domain error. */
export class ForkDataNotFoundError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ForkDataNotFoundError';
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
