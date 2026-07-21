# Security Policy

## Supported Versions

Only the latest published version of the `movehat` npm package receives
security updates. Pre-1.0 releases (`0.x`) may introduce breaking changes
alongside fixes.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < latest | :x:               |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report suspected vulnerabilities privately by email to:

**gilbertsahumada@gmail.com**

Include:

- A description of the issue and its impact
- Steps to reproduce (proof of concept, if possible)
- Affected version(s) of `movehat`
- Your environment (OS, Node version, Movement CLI version)

You can expect:

- An acknowledgement within **72 hours**
- A status update within **7 days**
- Coordinated disclosure once a fix is available

## Scope

In scope:

- The `movehat` CLI and npm package (`packages/movehat`)
- The fork server and account pool storage
- Example projects under `examples/`

Out of scope:

- Vulnerabilities in upstream dependencies (please report them upstream)
- Issues that require physical access to the developer's machine
- The documentation site, unless it leaks credentials or executes untrusted
  code

## Known advisories in non-published workspace dependencies

The CI audit gate (`pnpm audit --prod --audit-level critical`) currently
allows known non-critical advisories outside the published `movehat`
runtime package to pass. None of these reach the packed `movehat` npm
artifact; they affect the docs-site dependency tree and related
workspace build tooling.

Tracked state (2026-07-20):

- Current `pnpm audit --prod --audit-level critical`: passes with zero
  critical advisories (14 non-critical production findings remain: 7 high,
  6 moderate, 1 low).
- Socket's Next.js warning was actionable. The docs site moved from
  `next@^15.3.3` to the patched, same-major `next@^15.5.20`; the docs build is
  a required deterministic gate. No Next.js major upgrade or compatibility
  override was introduced.
- Vitest and its coverage plugin moved together from 4.0.16 to 4.1.10 to
  remove the critical Vitest UI advisory from development dependencies.
- `js-yaml` moved from 4.1.1 to 4.3.0 to remove its published-package DoS
  advisory. Other full-workspace findings are primarily transitive docs and
  test-tool paths; they remain visible in the scheduled informational audit.

The full audit is intentionally not silenced with broad pnpm overrides. Before
it can block PRs, any accepted advisory must be entered in a versioned allowlist
with scope, rationale, owner, and expiration. Until that review mechanism
exists, the exact blocking command remains
`pnpm audit --prod --audit-level critical`.

The published `packages/movehat` package is also guarded by a pack
contents check. The npm tarball must not contain raw `src/**`, compiled
tests, fixtures, snapshots, source maps, or common secret files.
