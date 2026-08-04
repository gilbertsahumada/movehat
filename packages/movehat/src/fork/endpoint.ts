import { URL } from 'node:url';
import { MovementApiError } from './errors.js';

/**
 * Validate and normalize a Movement API base URL without contacting it.
 *
 * Kept internal so `ForkManager` and `MovementApiClient` use the exact same
 * endpoint identity rules.
 */
export function normalizeMovementApiUrl(nodeUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(nodeUrl.replace(/\/$/, ''));
  } catch (cause) {
    throw new MovementApiError('Movement API URL is invalid', 'invalid_argument', { cause });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MovementApiError(
      `Unsupported Movement API protocol: ${parsed.protocol}`,
      'invalid_argument'
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new MovementApiError(
      'Movement API URL must not contain embedded credentials',
      'invalid_argument'
    );
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new MovementApiError(
      'Movement API URL must not contain a query string or fragment',
      'invalid_argument'
    );
  }
  return parsed.toString().replace(/\/$/, '');
}
