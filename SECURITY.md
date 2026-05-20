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

Tracked advisories (2026-05-20):

- Current `pnpm audit --prod --audit-level critical`: passes with zero
  critical advisories.
- Current full production audit count: 26 non-critical advisories
  (13 high, 11 moderate, 2 low).
- The previous workspace-root `http-proxy > follow-redirects` advisory
  path has been removed; `http-proxy` is no longer declared at the
  workspace root.

- **Next.js** (multiple) — middleware/proxy bypass, DoS, SSRF advisories
  in `next` ≥ 13.4.6 < 15.5.16. Path:
  `packages/docs > fumadocs-core@15.8.5 > next@15.5.12`.
- **Vite** (multiple) — `server.fs.deny` bypass, arbitrary file read.
  Path: `packages/docs > fumadocs-ui@15.x > vite@5.x` (transitive).
- **Rollup 4** — arbitrary file write via path traversal. Same path as Vite.
- **path-to-regexp** — DoS. Transitive via Next.js.
- **picomatch** — ReDoS via extglob. Transitive via Rollup/Vite.

Resolution path (in order):

1. Next.js ships a release that supports the docs site's
   static-export configuration (today's Next.js 16 introduces
   `useEffectEvent` semantics that break static export on Next.js 15
   APIs).
2. Fumadocs releases a version that depends on that Next.js.
3. We upgrade Fumadocs, which pulls in patched Next.js / Vite /
   Rollup transitively and clears all 13 high advisories above.

The repo cannot shortcut this chain (e.g. pin Next.js via
`pnpm.overrides`) because Fumadocs has tight version expectations
that breaking would crash the docs site build.

The published `packages/movehat` package is also guarded by a pack
contents check. The npm tarball must not contain raw `src/**`, compiled
tests, fixtures, snapshots, source maps, or common secret files.
