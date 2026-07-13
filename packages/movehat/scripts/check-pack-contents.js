import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const npmCache = mkdtempSync(resolve(tmpdir(), 'movehat-npm-pack-'));

const npmEnv = { ...process.env, npm_config_cache: npmCache };
delete npmEnv.npm_config_recursive;

let raw;
try {
  raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: npmEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} finally {
  rmSync(npmCache, { recursive: true, force: true });
}

// npm <= 11 emits `[ { ...packument } ]`; npm >= 12 emits
// `{ "<package-name>": { ...packument } }`.
const parsed = JSON.parse(raw);
const packument = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
if (!packument || !Array.isArray(packument.files)) {
  console.error('Unrecognized `npm pack --json` output shape; cannot verify package contents.');
  process.exit(1);
}
const files = packument.files.map((file) => file.path).sort();

const allowedTemplatePath = (path) => path.startsWith('dist/templates/');
const denied = files.filter((path) => {
  if (allowedTemplatePath(path)) return false;

  return (
    path === 'src' ||
    path.startsWith('src/') ||
    path.includes('/__tests__/') ||
    /(^|\/)__tests__(\/|$)/.test(path) ||
    /(^|\/)fixtures(\/|$)/.test(path) ||
    /\.test\.(?:[cm]?[jt]s|d\.ts)$/.test(path) ||
    path.endsWith('.map') ||
    path.endsWith('.snap') ||
    /(^|\/)\.env(?:$|\.)/.test(path) ||
    /(?:^|\/)(?:id_rsa|id_ed25519|\.npmrc|\.pypirc)$/.test(path)
  );
});

const required = ['bin/movehat.js', 'dist/index.js', 'dist/index.d.ts', 'dist/templates/package.json'];
const missing = required.filter((path) => !files.includes(path));

if (denied.length || missing.length) {
  if (denied.length) {
    console.error('npm package contains denied files:');
    for (const path of denied) console.error(`  - ${path}`);
  }
  if (missing.length) {
    console.error('npm package is missing required files:');
    for (const path of missing) console.error(`  - ${path}`);
  }
  process.exit(1);
}

console.log(
  `Package contents OK: ${packument.entryCount} files, ${packument.unpackedSize} unpacked bytes.`,
);
