// Verify that CHANGELOG.md contains a section header matching the version
// declared in packages/movehat/package.json. Blocks `npm publish` when the
// release lacks a corresponding `## [X.Y.Z]` entry.
//
// ESM, anchored via `import.meta.url` so the script works regardless of cwd.
//
// Usage:
//   node packages/movehat/scripts/check-changelog.js
//   node packages/movehat/scripts/check-changelog.js --allow-unreleased  # local testing

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '..', 'package.json');
const changelogPath = resolve(here, '..', '..', '..', 'CHANGELOG.md');

const allowUnreleased = process.argv.includes('--allow-unreleased');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version) {
  console.error(`Missing 'version' field in ${pkgPath}`);
  process.exit(1);
}

const changelog = readFileSync(changelogPath, 'utf8');

// Look for `## [<version>]` at the start of a line. The optional `- <date>`
// suffix is accepted but not required — backfilled rows may omit dates.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`^## \\[${escaped}\\](\\s|$)`, 'm');

if (pattern.test(changelog)) {
  console.log(`CHANGELOG.md has section for version ${version}`);
  process.exit(0);
}

if (allowUnreleased && /^## \[Unreleased\]/m.test(changelog)) {
  console.log(`CHANGELOG.md missing [${version}] but [Unreleased] is present and --allow-unreleased is set`);
  process.exit(0);
}

console.error(`Missing CHANGELOG section for version ${version}.`);
console.error(`Add a '## [${version}] - YYYY-MM-DD' header to CHANGELOG.md before publishing.`);
console.error(`(Run with --allow-unreleased to bypass when testing locally against [Unreleased].)`);
process.exit(1);
