export interface NpmRegistryResponse {
  "dist-tags": {
    latest: string;
    [tag: string]: string;
  };
  versions: Record<string, unknown>;
}

export interface FetchOptions {
  timeout?: number; // Timeout in milliseconds
  throwOnError?: boolean; // If true, throw errors; if false, return null on error
}

/**
 * Fetch latest version from npm registry
 * @param packageName - The npm package name
 * @param options - Fetch options (timeout, error handling)
 * @returns Latest version string, or null if failed and throwOnError is false
 */
export async function fetchLatestVersion(
  packageName: string,
  options: FetchOptions = {}
): Promise<string | null> {
  const { timeout = 0, throwOnError = false } = options;

  try {
    const controller = timeout > 0 ? new AbortController() : undefined;
    const timeoutId = timeout > 0 && controller
      ? setTimeout(() => controller.abort(), timeout)
      : undefined;

    const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
      signal: controller?.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      const error = new Error(`Failed to fetch package info: ${response.statusText}`);
      if (throwOnError) throw error;
      return null;
    }

    const data = (await response.json()) as NpmRegistryResponse;
    return data["dist-tags"].latest;
  } catch (error) {
    if (throwOnError) {
      throw new Error(
        `Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    // Silently fail - don't interrupt user's workflow
    return null;
  }
}
