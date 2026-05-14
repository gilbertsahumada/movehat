import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Path is anchored to this script's location so the check works
// regardless of the caller's `cwd`. Pre-extraction the inline
// `node -e` block in .github/workflows/ci.yml was invoked with
// `cd packages/movehat` first; anchoring removes that coupling.
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const required = ['name', 'version', 'description', 'author', 'license', 'repository', 'bin'];
const missing = required.filter((f) => !pkg[f]);

if (missing.length) {
  console.error(`Missing required fields in ${pkgPath}:`, missing);
  process.exit(1);
}
