/**
 * Escapes a shell argument to prevent command injection
 * Wraps the argument in single quotes and escapes any single quotes within
 *
 * @param arg - The argument to escape
 * @returns The escaped argument safe for shell execution
 */
export function escapeShellArg(arg: string): string {
  if (typeof arg !== "string") {
    throw new Error("Shell argument must be a string");
  }

  // Wrap in single quotes and escape any single quotes by replacing them with '\''
  // This technique works on both Unix and Windows (Git Bash, WSL)
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Validates that a path is safe (no command injection characters) and
 * returns it unchanged. Use this for callers that pass paths to spawn-with-
 * args (no shell), where shell quoting would be incorrect.
 *
 * @param path - The path to validate
 * @param name - Name for error messages (e.g., "package directory")
 * @returns The original path, after validation
 */
export function validatePathSafety(path: string, name: string = "path"): string {
  if (!path || typeof path !== "string") {
    throw new Error(`Invalid ${name}: must be a non-empty string`);
  }

  // Check for obvious command injection attempts.
  const dangerousChars = /[;&|`$(){}[\]<>]/;
  if (dangerousChars.test(path)) {
    throw new Error(
      `Invalid ${name}: "${path}"\n` +
      `Path contains potentially dangerous characters.\n` +
      `Allowed characters: letters, numbers, ., -, _, /, \\, spaces`
    );
  }

  return path;
}

/**
 * Validates a path and returns the shell-escaped form. Wraps
 * `validatePathSafety` for callers that pass paths into shell-style
 * commands (e.g. `exec`).
 *
 * @param path - The path to validate and escape
 * @param name - Name for error messages
 * @returns The escaped path safe for shell execution
 */
export function validateAndEscapePath(path: string, name: string = "path"): string {
  return escapeShellArg(validatePathSafety(path, name));
}

/**
 * Validates that a profile name is safe and returns it unchanged. Mirrors
 * `validatePathSafety` — use this for callers that pass the profile to
 * spawn-with-args (no shell), where shell quoting would be incorrect.
 */
export function validateProfileSafety(profile: string): string {
  if (!profile || typeof profile !== "string") {
    throw new Error("Invalid profile name: must be a non-empty string");
  }

  const safePattern = /^[a-zA-Z0-9_-]+$/;
  if (!safePattern.test(profile)) {
    throw new Error(
      `Invalid profile name: "${profile}"\n` +
      `Only alphanumeric characters, hyphens (-), and underscores (_) are allowed.`
    );
  }

  return profile;
}

/**
 * Validates a profile and returns the shell-escaped form. Wraps
 * `validateProfileSafety` for callers that pass the profile into shell-style
 * commands (e.g. `exec`).
 */
export function validateAndEscapeProfile(profile: string): string {
  return escapeShellArg(validateProfileSafety(profile));
}
