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
