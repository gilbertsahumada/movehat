import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve, sep } from "node:path";

const MOVEMENT_ENV_OVERRIDE = "MOVEHAT_MOVEMENT_BIN";

const SAFE_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "MOVEHAT_VERBOSE",
  "MOVEMENT_RPC_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

const SENSITIVE_ENV_NAME = /(?:^|_)(?:PRIVATE_?KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL|SESSION|COOKIE)(?:_|$)/i;

function normalizePathForCheck(pathname: string): string {
  return pathname.endsWith(sep) ? pathname : `${pathname}${sep}`;
}

function assertTrustedMovementPath(pathname: string, projectRoot: string): string {
  const absolute = realpathSync(pathname);
  const project = normalizePathForCheck(realpathSync(projectRoot));
  const normalizedAbsolute = normalizePathForCheck(absolute);

  if (normalizedAbsolute.startsWith(project)) {
    throw new Error(
      `Refusing to run Movement CLI from project-controlled path: ${absolute}. ` +
        `Install Movement CLI outside this project or set ${MOVEMENT_ENV_OVERRIDE} to a trusted absolute path.`
    );
  }

  if (absolute.split(sep).includes("node_modules")) {
    throw new Error(
      `Refusing to run Movement CLI from node_modules: ${absolute}. ` +
        `Install Movement CLI globally or set ${MOVEMENT_ENV_OVERRIDE} to a trusted absolute path.`
    );
  }

  return absolute;
}

function findOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? process.env.PATH ?? "";
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = resolve(dir, command);
    try {
      const stat = statSync(candidate);
      if (!stat.isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH.
    }
  }
  return null;
}

export function resolveMovementBinary(options: {
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
} = {}): string {
  const env = options.env ?? process.env;
  const projectRoot = options.projectRoot ?? process.cwd();
  const override = env[MOVEMENT_ENV_OVERRIDE];

  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(
        `${MOVEMENT_ENV_OVERRIDE} must be an absolute path, got: ${override}`
      );
    }
    accessSync(override, constants.X_OK);
    return assertTrustedMovementPath(override, projectRoot);
  }

  const resolved = findOnPath("movement", env);
  if (!resolved) {
    throw new Error(
      "Movement CLI not found on PATH. Install Movement CLI or set " +
        `${MOVEMENT_ENV_OVERRIDE} to a trusted absolute path.`
    );
  }

  return assertTrustedMovementPath(resolved, projectRoot);
}

export function sanitizeMovementEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_NAME.test(key)) continue;
    if (SAFE_ENV_NAMES.has(key)) {
      env[key] = value;
    }
  }

  return env;
}

