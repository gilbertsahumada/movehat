export type MovementApiErrorCode =
  | 'http_error'
  | 'timeout'
  | 'response_too_large'
  | 'invalid_response'
  | 'invalid_argument'
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

/**
 * Raised when an existing fork is re-initialized with a different persisted
 * network or endpoint identity.
 */
export class ForkIdentityMismatchError extends Error {
  /** Network label stored with the cached snapshot. */
  readonly storedNetwork: string;
  /** Network label requested by the rejected initialization. */
  readonly requestedNetwork: string;
  /** Whether the requested network label differs from the stored label. */
  readonly networkChanged: boolean;
  /** Whether the normalized requested endpoint differs from the stored endpoint. */
  readonly endpointChanged: boolean;

  constructor(storedNetwork: string, requestedNetwork: string, endpointChanged: boolean) {
    const networkChanged = storedNetwork !== requestedNetwork;
    const changed = [
      ...(networkChanged ? ['network'] : []),
      ...(endpointChanged ? ['endpoint'] : []),
    ].join(' and ') || 'requested identity';
    const verb = networkChanged && endpointChanged ? 'differ' : 'differs';
    super(
      `Fork identity mismatch: ${changed} ${verb} from the cached snapshot. ` +
        'Call load() to use the stored identity, initialize() with the original ' +
        'network and endpoint, or pass overwrite: true to replace the snapshot.'
    );
    this.name = 'ForkIdentityMismatchError';
    this.storedNetwork = storedNetwork;
    this.requestedNetwork = requestedNetwork;
    this.networkChanged = networkChanged;
    this.endpointChanged = endpointChanged;
  }
}

/** Signals that ForkStorage observed an uncommitted snapshot rotation. */
export class ForkCacheGenerationTransitionError extends Error {
  constructor(path: string) {
    super(`Fork cache generation is changing at ${path}`);
    this.name = 'ForkCacheGenerationTransitionError';
  }
}

export class ForkSnapshotChangedError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ForkSnapshotChangedError';
  }
}

export const FORK_SNAPSHOT_PRUNED_GUIDANCE =
  'Recreate the fork at a fresh ledger version (CLI: run movehat fork create again and confirm overwrite; API: initialize with overwrite: true). resetState() only clears local cache and cannot restore a pruned upstream snapshot.';

export const FORK_SNAPSHOT_CHANGED_GUIDANCE =
  'The fork snapshot changed after this ForkManager was loaded. Call load() to adopt the current snapshot or create a new ForkManager. If this came from movehat fork serve, restart the server. If the error persists after load() or a server restart, the snapshot rotation was interrupted; recreate the fork with overwrite (CLI: run movehat fork create again and confirm overwrite; API: call initialize() with overwrite: true).';

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
