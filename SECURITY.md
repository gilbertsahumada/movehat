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

## Known advisories in development dependencies

The CI audit gate (`pnpm audit --prod --audit-level critical`) currently
allows known high-severity advisories in development-only transitive
dependencies of `packages/docs` to pass. None of these reach the
published `movehat` package on npm; they affect only the docs-site
build pipeline and the hosted static site.

Tracked advisories (2026-05-16):

- **Next.js** (multiple) — middleware/proxy bypass, DoS, SSRF advisories
  in `next` ≥ 13.4.6 < 15.5.16. Path:
  `packages/docs > fumadocs-core@15.8.5 > next@15.5.12`.
- **Vite** (multiple) — `server.fs.deny` bypass, arbitrary file read.
  Path: `packages/docs > fumadocs-ui@15.x > vite@5.x` (transitive).
- **Rollup 4** — arbitrary file write via path traversal. Same path as Vite.
- **path-to-regexp** — DoS. Transitive via Next.js.
- **picomatch** — ReDoS via extglob. Transitive via Rollup/Vite.

These will be resolved when Fumadocs releases a version compatible with
Next.js 16+ (which patches the Next CVEs and pulls in patched Vite/Rollup).
The repo cannot upgrade Fumadocs unilaterally because Next.js 16 requires
`useEffectEvent` semantics that break the docs site's static-export build
on Next.js 15.

The published `packages/movehat` package has zero advisories.
