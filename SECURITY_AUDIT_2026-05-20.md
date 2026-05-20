# Movehat Security Audit Report

Date: 2026-05-20

Repository: `/Users/gilbertsahumada/projects/movehat`

Branch/worktree observed during audit: `m8.0/fork-view-proxy` / repo root

Primary scope: `packages/movehat`, examples, release/test scripts, security policy, published package contents, and production dependencies. The untracked `grant/` directory was intentionally excluded.

## Executive Summary

This audit found no confirmed Critical or High vulnerabilities in the published `movehat` runtime paths. The strongest confirmed risks are Medium severity issues around local execution trust boundaries: resolving the `movement` binary from `PATH`, passing full environment variables to subprocesses, child processes that may continue after timeout/abort, local fork server CSRF-style abuse, accidental persistence of imported private keys, and broad npm package contents.

Several important assumptions were confirmed as sound: command execution uses `spawn(command, args)` rather than shell interpolation, private keys are passed to Movement CLI through temporary `0o600` files instead of argv, the fork server binds to `127.0.0.1` by default, CORS does not wildcard browser reads, and `forkApiKey` is not persisted to disk.

Dependency audit results are not clean, but the current critical gate passes. `pnpm audit --prod --audit-level critical` reported 0 critical advisories. A full production audit reported 27 non-critical advisories: 13 high, 12 moderate, and 2 low. Most are in the docs/Fumadocs/Next/Vite/Rollup tree, but at least one advisory path is rooted at the workspace-level `http-proxy > follow-redirects` dependency.

## Remediation Addendum — 2026-05-20

### Current Remediation Status

The implementation pass requested after the revalidation addendum closes the confirmed runtime/package Medium findings and the associated Low hardening items that were in scope for the remediation plan.

Current remediation summary:

- All original Medium findings M1-M7 have direct code or CI remediation.
- Low findings L1-L8 and revalidation follow-ups R1-R2 have direct remediation or updated policy documentation.
- The remaining dependency-audit noise is limited to non-critical advisories in the docs/Fumadocs/Next/Vite/Rollup/PostCSS/picomatch/path-to-regexp dependency tree.
- The previous workspace-root `http-proxy > follow-redirects` advisory path has been removed. `pnpm why follow-redirects` now returns no path.
- The packed `movehat` npm artifact is now checked by an automated denylist and currently packs 141 files without raw `src/**`, compiled tests, fixtures, or sourcemaps.

### Remediation Commands and Results

Commands run after remediation:

```sh
pnpm --filter movehat build
pnpm --filter movehat run check-pack-contents
pnpm --filter movehat exec vitest run src/utils/__tests__/childProcessAdapter.test.ts src/utils/__tests__/childProcessAdapter.maxBuffer.test.ts src/utils/__tests__/movementCli.test.ts src/utils/__tests__/runCli.test.ts src/node/__tests__/LocalNodeManager.test.ts src/core/__tests__/AccountManager.test.ts src/core/__tests__/AccountManager.global-state.test.ts src/fork/__tests__/server.test.ts src/fork/__tests__/server.cors.test.ts src/fork/__tests__/storage.test.ts src/commands/fork/__tests__/create.test.ts
pnpm --filter movehat test
pnpm audit --prod --audit-level critical
pnpm audit --prod
pnpm why follow-redirects
git diff --check
```

Results:

- `pnpm --filter movehat build`: passed.
- `pnpm --filter movehat run check-pack-contents`: passed; package dry-run result was 141 files and 436,961 unpacked bytes.
- Focused security regression suite: passed, 11 files and 149 tests.
- Full `movehat` unit suite: passed, 47 files and 506 tests.
- `pnpm audit --prod --audit-level critical`: passed; there are still zero critical advisories.
- `pnpm audit --prod`: failed as expected under the broader audit policy with 26 non-critical advisories: 13 high, 11 moderate, 2 low.
- `pnpm why follow-redirects`: no output, confirming the previous root `http-proxy > follow-redirects` path is gone.
- `git diff --check`: passed.

### Finding Closure Table

| Finding | Remediation status | Implemented control |
|---|---:|---|
| M1. `movement` binary trusted from `PATH` | Closed | Added a central Movement CLI resolver that resolves to a real absolute executable path, supports only absolute `MOVEHAT_MOVEMENT_BIN`, and refuses project-controlled or `node_modules` paths. `runCli()` resolves bare `movement` when using the default adapter, and `LocalNodeManager` resolves the spawn path for real local-node runs. |
| M2. Timed-out or aborted child processes may keep running | Closed | `childProcessAdapter.run()` now sends `SIGTERM`, waits for process close, escalates to `SIGKILL` after a grace window, and settles timeout/maxBuffer failures only after the child lifecycle is controlled. Added regression tests for delayed SIGTERM close. |
| M3. Movement subprocesses inherit full `process.env` | Closed | Added `sanitizeMovementEnv()` and applies it to default-adapter Movement CLI calls. Secret-shaped variables such as `PRIVATE_KEY`, `*_TOKEN`, `*_SECRET`, credentials, cookies, auth values, and passwords are dropped. Operational values such as `PATH`, `HOME`, `TMPDIR`, proxy settings, color settings, CI, and `MOVEMENT_RPC_URL` are retained. |
| M4. Fork server CORS blocks browser reads but not local-service abuse | Closed | Fork server now rejects untrusted `Origin` requests with `403` before route handlers run, while still allowing no-Origin local CLI/API requests. Allowed preflight requests are handled without executing endpoint handlers. |
| M5. Imported private keys can be accidentally persisted | Closed | `AccountManager` now tracks generated versus imported accounts. `saveAccountPool()` persists generated accounts by default and skips accounts loaded from private keys/env/config unless `includeImported: true` is passed explicitly. |
| M6. npm package includes source/tests/fixtures/source maps | Closed | Removed `src` from package `files`, disabled source/declaration maps for published build output, excluded tests from `tsconfig`, cleaned `dist` before build, and added `check-pack-contents` to fail on raw source, compiled tests, fixtures, snapshots, sourcemaps, or common secret files. |
| M7. Release gate does not run dependency audit before npm publish | Closed | `.github/workflows/publish.yml` now runs `pnpm audit --prod --audit-level critical` before release versioning/publish and runs the pack-content denylist before `npm publish`. |
| L1. Unexpected HTTP methods accepted on fork server read endpoints | Closed | Known fork endpoints now enforce `GET` for read routes and `POST` for `/v1/view`, returning `405` with `Allow` on method mismatch. |
| L2. Malformed percent encoding in resource path returns `500` | Closed | Resource path decoding now catches malformed percent encoding and returns `400 malformed_path`. |
| L3. Upstream RPC errors can be logged without enough redaction | Closed | Upstream view-proxy errors are redacted through `redactSecrets()` and log-sanitized before both logging and response construction. |
| L4. Fork storage does not force restrictive permissions | Closed | Fork directories are forced to `0700`; fork JSON/cache files are written/chmodded to `0600`. |
| L5. `fork create --name` needs traversal validation | Closed | Added `validateForkName()` with basename/allowlist checks and rejection of separators, traversal, empty, and reserved names. |
| L6. Raw unlabelled `0x` private keys are not fully redacted | Closed | Redaction now covers AIP-80 private-key literals beyond Ed25519 and raw 64-byte hex values when adjacent to private-key context or CLI key flags, while preserving normal account-address output without key context. |
| L7. `SECURITY.md` advisory notes are stale | Closed | `SECURITY.md` now documents the current 26 non-critical advisories, the critical-only gate, the removed `http-proxy` path, and the pack-content control. |
| L8. Inherited-stdio commands can run without timeout | Closed | `childProcessAdapter.run()` now applies a 30-minute default timeout to `inheritStdio` commands unless callers provide a specific timeout. |
| R1. CI security comment is stale | Closed | `.github/workflows/ci.yml` comments now distinguish docs/workspace non-critical advisories from the critical production gate and no longer claim all advisories are docs-only. |
| R2. Reference CI verifies Movement CLI hash only on cache miss | Closed | Example and docs workflows now verify the installed `/usr/local/bin/movement` binary SHA256 on every run, covering both cache hits and fresh installs. |

### Files and Controls Added

Notable implementation files:

- `packages/movehat/src/utils/movementCli.ts`: trusted Movement binary resolution and sanitized Movement CLI environment.
- `packages/movehat/src/utils/childProcessAdapter.ts`: controlled termination on timeout, abort, and maxBuffer overflow.
- `packages/movehat/src/fork/server.ts`: origin blocking, method enforcement, malformed path handling, and redacted upstream error logging.
- `packages/movehat/src/fork/storage.ts`: restrictive fork-cache permissions and controlled JSON parse errors.
- `packages/movehat/src/core/AccountManager.ts`: generated/imported account provenance and explicit `includeImported` persistence opt-in.
- `packages/movehat/scripts/check-pack-contents.js`: npm pack-content denylist.
- `.github/workflows/ci.yml` and `.github/workflows/publish.yml`: package-content checks and publish-time audit gate.
- `SECURITY.md`: updated dependency-advisory and package-content policy.

### Residual Risks and Accepted Boundaries

The following are still intentional trust boundaries, not reopened vulnerabilities:

- `movehat run` and TypeScript test execution run user project code and therefore can read the user's environment. This is expected for local developer tooling.
- `movehat.config.ts/js` is executable project configuration and must be treated as trusted project code.
- The full workspace `pnpm audit --prod` still reports 26 non-critical advisories in the docs dependency tree. The critical gate passes, and the remaining advisories are documented in `SECURITY.md` pending upstream Fumadocs/Next/Vite/Rollup compatibility updates.

## Revalidation Addendum — 2026-05-20

### Current Status

This report remains materially valid after the subsequent code changes reviewed on 2026-05-20.

Revalidation context:

- Current branch observed: `chore/issue-lifecycle-convention`.
- Current HEAD observed: `0fdfc8b docs(claude): add §10 issue-lifecycle convention`.
- Baseline range inspected for new changes: `d7460b5..HEAD`.
- Audit-sensitive files changed since the original report:
  - `packages/movehat/src/fork/api.ts`
  - `packages/movehat/src/fork/manager.ts`
  - `packages/movehat/src/fork/server.ts`
  - `packages/movehat/src/harness/Harness.ts`
  - `packages/movehat/src/harness/proxy.ts`
  - `packages/movehat/src/fork/__tests__/server.test.ts`
  - `packages/movehat/src/fork/__tests__/server.cors.test.ts`
  - `packages/movehat/src/__tests__/fork/api.test.ts`
  - `packages/movehat/src/__tests__/harness/Harness.proxy.test.ts`
  - `.github/workflows/ci.yml`
  - `.github/workflows/publish.yml`
  - `examples/counter-example/.github/workflows/ci.yml`
  - `packages/docs/content/docs/guides/tutorial-ci.mdx`
  - `packages/docs/content/docs/guides/tutorial-deploy-live.mdx`
  - `CLAUDE.md`
  - `ROADMAP.md`

No original Medium finding should be closed based on the current code. The new fork/proxy work improves read-only fork behavior and narrows header passthrough, but it does not address the existing Medium findings around command resolution, process lifecycle, env inheritance, local fork server abuse, key persistence, package contents, or publish-time dependency audit policy.

### Revalidation Commands and Results

Commands run during revalidation:

```sh
git status --short --untracked-files=all
git log --oneline --decorate -12
git show --name-only --oneline --no-renames d7460b5..HEAD
pnpm --filter movehat build
pnpm --filter movehat exec vitest run src/fork/__tests__/server.test.ts src/fork/__tests__/server.cors.test.ts src/__tests__/fork/api.test.ts src/__tests__/harness/Harness.proxy.test.ts
pnpm audit --prod --audit-level critical
pnpm audit --prod
pnpm why follow-redirects
npm_config_cache=/private/tmp/movehat-npm-cache npm pack --dry-run --json --ignore-scripts
```

Results:

- `pnpm --filter movehat build`: passed.
- Focused fork/proxy/harness test run: passed, 4 test files and 19 tests.
- `pnpm audit --prod --audit-level critical`: passed, because there are still no critical production advisories.
- `pnpm audit --prod`: failed as expected with the current policy because 27 production advisories remain across the workspace: 13 high, 12 moderate, and 2 low.
- `pnpm why follow-redirects`: confirmed `follow-redirects@1.15.11` is still pulled through root `http-proxy@1.18.1`.
- `npm pack --dry-run --json --ignore-scripts` in `packages/movehat`: passed and confirmed the package-content finding remains current. The dry-run package is `movehat@0.2.4`, `398359` bytes packed, `1876986` bytes unpacked, `571` entries, and still includes built tests, source maps, and raw `src/**` files.

### Finding-by-Finding Revalidation

| Finding | Current status | Revalidation notes |
|---|---:|---|
| M1. `movement` binary trusted from `PATH` | Still valid | Bare `movement` command invocations remain in compile, publish, script, code-object, Move-test, and local-node paths. No central trusted binary resolver or project-local binary refusal was added. |
| M2. Timed-out or aborted child processes may keep running | Still valid | `childProcessAdapter` still rejects after timeout/abort/maxBuffer paths without a confirmed close/escalation sequence such as TERM grace period followed by KILL. |
| M3. Movement subprocesses inherit full `process.env` | Still valid | The adapter still defaults to `input.env ?? process.env`, and sensitive Movement call sites do not pass a sanitized env by default. |
| M4. Fork server CORS blocks browser reads but not local-service abuse | Still valid | `applyCors()` controls response headers, but untrusted-Origin requests are still routed. This remains a browser-origin/local-service abuse risk, not a LAN exposure issue. |
| M5. Imported private keys can be accidentally persisted | Still valid | `loadAccountFromPrivateKey()` still records imported keys in the same in-memory pool that `saveAccountPool()` persists. |
| M6. npm package includes source/tests/fixtures/source maps | Still valid | Pack dry-run still shows raw `src/**`, `dist/**/__tests__`, and many `.map` files in the published tarball. |
| M7. Release gate does not run dependency audit before npm publish | Still valid | The main CI security job has a critical-only audit gate, but `.github/workflows/publish.yml` still does not run an audit before `npm publish`. |
| L1. Unexpected HTTP methods accepted on fork server read endpoints | Still valid | The server still routes read endpoints mostly by path, not method. `POST /v1/view` is method-gated, but ledger/account/resource/resources endpoints are not uniformly `GET`-gated. |
| L2. Malformed percent encoding in resource path returns 500 | Still valid | `decodeURIComponent()` is still inside the route body and malformed escapes still fall into generic error handling instead of a deliberate `400`. |
| L3. Upstream RPC errors log without enough redaction | Still valid | `handleViewProxy()` sanitizes control characters and truncates the response message, but logs the raw upstream error with `logger.error(... rawMsg ...)`. Token-like content from upstream can still land in server logs. |
| L4. Fork storage permissions not restrictive | Still valid | No new restrictive mode enforcement was observed for fork directories/resource JSON beyond existing behavior. |
| L5. `fork create --name` traversal validation | Still valid | No new validation was observed in the touched fork-create path during this revalidation. |
| L6. Raw unlabelled `0x` keys not fully redacted | Still valid | No broad redaction expansion for unlabeled raw hex key material was observed. |
| L7. `SECURITY.md` stale | Still valid | The security policy remains unchanged by the reviewed commits. |
| L8. Inherited-stdio commands unbounded | Still valid | No new timeout/kill guarantee was added for inherited-stdio command paths. |

### Positive Changes Confirmed

The following changes improve security posture or reduce dangerous ambiguity, but they do not close the Medium findings above:

- Fork-mode `MoveContract.call()` is now synchronously blocked by `createForkContractProxy()`. This prevents a write-like contract call from falling through to the fork server's unimplemented `/v1/transactions` path and surfacing as a misleading HTTP 404.
- `Harness.createFork()` wraps `runtime.getContract()` so fork-mode contracts reject `.call()` while preserving `.view()` and `getModuleId()`.
- `POST /v1/view` now has a 1 MiB request-body ceiling, rejects malformed JSON with `400 invalid_body`, maps upstream failures to `502 upstream_error`, and forwards view calls through `forkManager.forwardView()`.
- Client header passthrough from the fork server to upstream RPC is narrow. The server forwards only `Accept` and `X-Aptos-Client`, using canonical header names. It does not forward `Authorization`, `Cookie`, `Host`, `Connection`, `Content-Length`, or other hop-by-hop/client credential headers.
- The CI tutorial and example workflow pin the downloaded Movement CLI artifact by SHA256 before installing it.
- The live-deploy tutorial includes clear safety language around real transactions, `PRIVATE_KEY`, `.env`, and avoiding `createLive()` in tests.
- The publish workflow already uses npm Trusted Publishers/provenance and validates release/manual versions with a strict semver regex before downstream shell interpolation.

### New or Changed Issues From Revalidation

#### R1. CI Security Comment Is Now Stale

Severity: Low / documentation-control mismatch

Affected file:

- `.github/workflows/ci.yml`

The current CI security job comments that all current audit findings are transitive dependencies of `packages/docs` and that the published `packages/movehat` package has zero advisories. Revalidation confirms the first statement is no longer fully accurate: `pnpm why follow-redirects` shows a root production path:

```text
movehat-workspace@1.0.0
dependencies:
http-proxy 1.18.1
└── follow-redirects 1.15.11
```

This does not change the critical gate result, but it makes the workflow comment misleading. Recommended fix: update the comment to distinguish docs-only advisories from workspace-root advisories, and either justify or remove the root `http-proxy` dependency if it is no longer needed.

#### R2. Reference CI Verifies the Movement CLI Hash Only on Cache Miss

Severity: Low / supply-chain hardening

Affected files:

- `examples/counter-example/.github/workflows/ci.yml`
- `packages/docs/content/docs/guides/tutorial-ci.mdx`

The reference workflow pins the Movement CLI artifact SHA256 during install, which is good. However, when `actions/cache` restores `/usr/local/bin/movement`, the workflow skips the download/hash step and only runs `movement --version`. A poisoned or stale cache entry would not be detected by the same SHA256 check.

This is a hardening issue rather than a confirmed exploit in Movehat itself. Recommended fix: verify the restored binary's SHA256 on every run, not only on cache miss. A simple pattern is to hash `/usr/local/bin/movement` after either restore or install and compare it against the same pinned value.

### Revised Priority Backlog After Revalidation

The original backlog order remains mostly correct. Adjusted priorities:

1. Resolve `movement` to a trusted absolute path and sanitize Movement CLI environments.
2. Fix child process lifecycle on timeout/abort/maxBuffer overflow.
3. Block untrusted Origin requests before fork server routing and enforce HTTP methods.
4. Prevent imported private keys from being saved by `saveAccountPool()` by default.
5. Tighten npm package contents and add pack-content denylist checks.
6. Add publish-time dependency audit policy; update stale CI audit comments; remove or justify root `http-proxy`.
7. Verify cached Movement CLI binaries by SHA256 in example/docs CI workflows.
8. Harden fork storage permissions and corrupt JSON/schema handling.
9. Sanitize upstream RPC error logs.
10. Validate `fork create --name`.
11. Update `SECURITY.md`.

### Revalidation Conclusion

The original report is still current. The latest code changes are directionally positive for fork-mode ergonomics and header passthrough, and the focused tests pass. They do not invalidate the confirmed Medium findings, and they add two Low follow-ups around stale CI audit documentation and cache-hit hash verification in the reference CI workflow.

## Scope and Methodology

The audit used a multi-agent review plus local validation. Agents split the repository by risk domain:

- Command execution and shell/process safety.
- Secrets, private keys, local file storage, and logging.
- Fork server, RPC proxying, CORS, and network exposure.
- Config execution, supply chain, package publishing, and docs leakage.
- Test coverage and security assumptions.

The review emphasized confirmed exploitability over speculation. Findings below include affected code, preconditions, controls already present, impact, recommended fixes, and remediation tests.

## Verification Commands and Results

Commands run locally:

```sh
pnpm --filter movehat build
pnpm --filter movehat test
pnpm audit --prod --audit-level critical
pnpm audit --prod --json
npm pack --dry-run
```

Results:

- `pnpm --filter movehat build`: passed.
- `pnpm --filter movehat test`: failed in this sandbox because localhost listeners and `tsx` IPC were blocked with `EPERM`. The failures were in tests that bind `127.0.0.1`, `::1`, or create a `tsx` IPC pipe. This was treated as an environment limitation, not a functional failure.
- Targeted agent reruns outside sandbox reportedly passed for fork server, CORS, storage/API, and SIGINT private-key cleanup tests.
- `pnpm audit --prod --audit-level critical`: passed with 0 critical advisories.
- Full audit: 27 production advisories across the workspace, with 13 high, 12 moderate, 2 low, 0 critical.
- `npm pack --dry-run` in the local environment failed because `~/.npm` cache had permission problems. A sub-agent used `npm pack --dry-run --json --ignore-scripts` with a temporary npm cache and confirmed the package content issue described below.

## Severity Model

- Critical: remote or unauthenticated compromise of secrets, funds, arbitrary command execution, or published package integrity.
- High: likely compromise of private keys, transactions, persistent code execution, or externally reachable sensitive services.
- Medium: meaningful security weakness with local-user, project-trust, browser-CSRF, malicious dependency, or misconfiguration preconditions.
- Low: robustness, hardening, incorrect error class, limited local DoS, disclosure process risk, or defense-in-depth improvement.
- Informational: expected trust boundary or documented behavior that must remain explicit.

## Confirmed Medium Findings

### M1. `movement` Binary Is Trusted From `PATH`

Affected areas:

- `packages/movehat/src/commands/compile.ts`
- `packages/movehat/src/core/Publisher.ts`
- `packages/movehat/src/harness/script.ts`
- `packages/movehat/src/harness/codeObject.ts`
- `packages/movehat/src/helpers/move-tests.ts`
- `packages/movehat/src/node/LocalNodeManager.ts`

Evidence:

The CLI invokes `movement` as a bare command name across compile, publish, script execution, code object deploy/upgrade, Move tests, and local node startup. Because command resolution is delegated to `PATH`, any earlier executable named `movement` is trusted.

Preconditions:

- An attacker controls `PATH`, or
- a malicious project places a fake `movement` earlier in `PATH`, for example via `node_modules/.bin`, shell startup files, or task runner environment, and
- the user runs a Movehat command that invokes Movement CLI.

Impact:

For compile/test paths, this is local command execution as the user. For publish, deploy-object, upgrade-object, and run-script paths, the fake binary receives `--private-key-file <path>` and can read the temporary key file as the same user before Movehat cleans it up.

Existing controls:

- No shell interpolation is used.
- The raw private key is not passed directly in argv.
- The temporary private-key file is `0o600`.

Recommended fix:

- Add a central `resolveMovementBinary()` helper.
- Resolve `movement` to an absolute path before execution.
- Warn or refuse if the resolved binary is inside the current project, `node_modules`, or another project-controlled path unless explicitly allowed.
- Support an explicit trusted binary override, for example `MOVEHAT_MOVEMENT_BIN` or config-level `movementBin`.
- Use the resolved absolute path in all Movement CLI call sites.

Recommended tests:

- Put a fake `movement` earlier in `PATH` and verify sensitive commands refuse or warn.
- Verify an explicit trusted binary path is honored.
- Verify publish/script/code-object tests do not hand `--private-key-file` to a project-local fake binary by default.

### M2. Timed-Out or Aborted Child Processes May Keep Running

Affected file:

- `packages/movehat/src/utils/childProcessAdapter.ts`

Evidence:

The default child process adapter sends `SIGTERM` on timeout, output overflow, or abort, then rejects or continues without confirming the process has actually exited. A child that traps or ignores `SIGTERM` can continue running after Movehat reports failure.

Preconditions:

- A child process is hostile, wedged, or intentionally traps `SIGTERM`.
- The command is one of the external process paths, such as `movement`, `node`, `mocha`, or a test/script child.

Impact:

Movehat may report timeout/failure while the child keeps running. In publish/script/deploy-object flows, the child could continue writing files, consuming CPU/network, or submitting transactions after callers assume it stopped.

Existing controls:

- Many captured Movement CLI calls have explicit timeouts.
- `LocalNodeManager.stop()` already has a stronger pattern: `SIGTERM`, wait, then `SIGKILL`.

Recommended fix:

- In `DefaultChildProcessAdapter.run()`, on timeout/abort/maxBuffer overflow:
  - send `SIGTERM`;
  - wait a short grace period;
  - escalate to `SIGKILL` if the child has not exited;
  - settle the promise only after lifecycle is controlled.
- Ensure there is only one settlement path for timeout, abort, child error, close, and maxBuffer overflow.

Recommended tests:

- Spawn a fixture child that traps `SIGTERM`.
- Verify timeout escalates to `SIGKILL`.
- Verify abort does not leave the child running.
- Verify maxBuffer overflow kills the child and does not double-reject.

### M3. Movement Subprocesses Inherit Full `process.env`

Affected file:

- `packages/movehat/src/utils/childProcessAdapter.ts`

Evidence:

The default adapter uses `env: input.env ?? process.env`. Most Movement CLI call sites do not provide a sanitized environment, so `PRIVATE_KEY`, RPC tokens, npm tokens, cloud credentials, and unrelated secrets can be inherited.

Preconditions:

- Sensitive values exist in the parent environment.
- A Movement CLI subprocess is compromised, malicious, PATH-hijacked, or invokes untrusted dependency behavior.

Impact:

Secrets unrelated to the command can be exposed to subprocesses. This compounds the `PATH` hijack risk: a fake `movement` can read both the private-key temp file and inherited environment secrets.

Existing controls:

- CLI stdout/stderr redaction is applied for captured `runCli` output.
- Private keys are passed through a temp file, not argv.

Recommended fix:

- Add a `safeChildEnv()` helper for Movement CLI and local node calls.
- Drop known sensitive variables by default, including `PRIVATE_KEY`, common `*_PRIVATE_KEY`, `*_TOKEN`, `*_SECRET`, cloud credentials, npm tokens, and CI secrets.
- Preserve required non-secret environment such as `PATH`, `HOME`, `TMPDIR`, `NO_COLOR`, and explicitly needed Movement variables.
- Keep full env only for intentional user-code execution paths such as `movehat run` and project Mocha tests, or document and gate that behavior clearly.

Recommended tests:

- Set `PRIVATE_KEY` and representative token env vars, invoke a fake adapter, and assert Movement CLI call env does not include them.
- Assert `movehat run` and TypeScript test paths retain full env by design, or add an explicit opt-in/opt-out flag and test it.

### M4. Fork Server CORS Blocks Browser Reads but Not Local-Service Abuse

Affected file:

- `packages/movehat/src/fork/server.ts`

Evidence:

The fork server only emits `Access-Control-Allow-Origin` when the request Origin is allowlisted. If the Origin is untrusted, the request is still routed and processed. Browsers cannot read the response, but they can still cause work to happen.

Preconditions:

- A user has `movehat fork serve` or a helper-started fork server running.
- A malicious web page or local process can reach `127.0.0.1:<port>`.

Impact:

This enables CSRF-style abuse of the local service:

- Account/resource/view requests can trigger upstream RPC calls.
- Responses can be cached to disk.
- API quota can be consumed.
- Logs can be polluted.
- `/v1/view` can proxy attacker-selected view payloads to the configured upstream node.

Existing controls:

- Default bind is `127.0.0.1`.
- No wildcard CORS is emitted.
- `/v1/view` has a 1 MiB body limit.

Recommended fix:

- If an `Origin` header exists and is not allowlisted, return `403` before routing.
- Keep requests with no Origin working for CLI/server-side clients.
- Expose CORS allowlist configuration through CLI/helper APIs if a browser UI needs to talk to the fork server.
- Consider requiring `Content-Type: application/json` and/or a custom header for `/v1/view` to force preflight for browser clients.

Recommended tests:

- Untrusted `Origin` on `GET /v1/` returns `403` and does not call `ForkManager`.
- Untrusted `Origin` on resource/account endpoints returns `403`.
- Untrusted `Origin` on `POST /v1/view` returns `403` and does not call upstream.
- Allowlisted Origin and no-Origin requests continue to work.

### M5. Imported Private Keys Can Be Accidentally Persisted in Account Pool

Affected file:

- `packages/movehat/src/core/AccountManager.ts`

Evidence:

`loadAccountFromPrivateKey()` adds any loaded key to the static pool and private-key map. `saveAccountPool()` persists every tracked key to `.movehat/accounts/test-pool.json` as plaintext JSON with `0o600` file permissions.

Preconditions:

- A process loads a real account from config or `PRIVATE_KEY`.
- The same process later calls `AccountManager.saveAccountPool()`.

Impact:

A key intended only for signing can be persisted to disk under an API named around test account pools. Permissions reduce cross-user exposure, but the key remains on disk and may be copied, backed up, indexed, or leaked later.

Existing controls:

- The account pool directory is forced to `0o700`.
- The account pool file is forced to `0o600`.
- `.movehat/` is gitignored in templates.

Recommended fix:

- Track account provenance.
- Mark accounts generated by `createAccount()` as persistable.
- Mark accounts loaded from env/config/imported private keys as non-persistable by default.
- Add an explicit opt-in, for example `saveAccountPool({ includeImported: true })`, if imported keys must be persisted.

Recommended tests:

- Load a private key via `loadAccountFromPrivateKey()`, call `saveAccountPool()`, and assert the imported key is absent by default.
- Generate accounts via `createAccount()`, call `saveAccountPool()`, and assert generated test keys persist.
- Add an explicit opt-in test if `includeImported` is supported.

### M6. npm Package Includes Source, Tests, Fixtures, Source Maps, and Duplicate Templates

Affected files:

- `packages/movehat/package.json`
- `packages/movehat/tsconfig.json`

Evidence:

The package `files` list includes `dist`, `src`, and `bin`. The TypeScript build compiles all `src/**/*` except templates. A sub-agent pack dry run confirmed 571 published entries, including compiled tests, source tests, source maps, and both `src/templates` and `dist/templates`.

Preconditions:

- A package is published with the current package contents.

Impact:

This is not direct RCE, but it increases the published attack surface and future leak risk. Internal tests and fixtures become part of the npm artifact. Source maps can reveal internal source layout and code that consumers do not need. Duplicate templates increase package size and review burden.

Existing controls:

- The `files` array prevents publishing the whole repository.
- Release scripts check for required files, but not for forbidden files.

Recommended fix:

- Publish only runtime artifacts:
  - `dist`
  - `bin`
  - `README.md`
  - `package.json`
  - license/changelog metadata as needed
- Exclude:
  - `src`
  - `**/__tests__/**`
  - `*.test.*`
  - fixtures not needed at runtime
  - source maps, unless there is a deliberate debugging policy
- Ensure templates are included once, preferably under `dist/templates` if runtime code resolves them there.

Recommended tests:

- Add a package-content check using `npm pack --dry-run --json --ignore-scripts`.
- Fail if the artifact contains `src/`, `__tests__/`, `*.test.*`, fixture-only files, or duplicate templates.
- Assert required runtime files remain present.

### M7. Release Gate Does Not Run Dependency Audit Before npm Publish

Affected areas:

- GitHub publish workflow.
- Root/package dependency policy.
- `SECURITY.md`.

Evidence:

The publish workflow runs build/test/publish steps but does not run a dependency audit gate immediately before publish. CI has a critical audit gate, but release should independently enforce the policy.

Current audit results:

- `pnpm audit --prod --audit-level critical`: 0 critical advisories.
- Full audit: 27 advisories: 13 high, 12 moderate, 2 low.
- Most advisories are in docs dependencies: Next.js, Vite, Rollup, PostCSS, picomatch, path-to-regexp through Fumadocs.
- One advisory path is rooted at workspace `http-proxy > follow-redirects`; `http-proxy` appears to be declared at the root and should be reviewed for actual use.

Impact:

A future publish can proceed even if a production advisory affecting the published package or root workspace is present, as long as tests pass. The stale security policy can also mislead maintainers about the current advisory set.

Existing controls:

- Trusted Publishers/provenance.
- Version/changelog checks.
- Unit/integration/smoke testing.
- CI critical audit.

Recommended fix:

- Add `pnpm audit --prod --audit-level critical` to the publish workflow at minimum.
- Add a more nuanced audit policy:
  - fail any production advisory in `packages/movehat`;
  - fail root production advisories unless explicitly allowlisted;
  - allow docs-only non-critical advisories with documented rationale.
- Remove unused root `http-proxy` if not needed.
- Update `SECURITY.md` with generated advisory summaries split by `packages/movehat`, docs, and root workspace.

Recommended tests/checks:

- Workflow or script test that fails on root or `packages/movehat` production advisories.
- Generated audit summary checked into CI or release logs.

## Low-Risk Findings and Hardening Items

### L1. Fork Server Accepts Unexpected HTTP Methods on Read Endpoints

Affected file:

- `packages/movehat/src/fork/server.ts`

Issue:

Ledger, account, resource, and resources routes are matched primarily by pathname. `/v1/view` explicitly requires `POST`, but read endpoints do not explicitly require `GET`.

Impact:

This increases method confusion and CSRF/DoS surface. The endpoints are read-only from the chain perspective, but they can still fetch and cache upstream data.

Fix:

- Require `GET` for ledger/account/resource(s).
- Require `POST` for `/v1/view`.
- Support `OPTIONS` only as CORS preflight.
- Return `405 Method Not Allowed` with `Allow`.

Tests:

- `POST /v1/accounts/<addr>` returns `405`.
- `PUT /v1/` returns `405`.
- Wrong-method requests do not call upstream/cache.

### L2. Malformed Percent-Encoding in Resource Path Returns `500`

Affected file:

- `packages/movehat/src/fork/server.ts`

Issue:

`decodeURIComponent()` can throw `URIError` for malformed encoding. The generic catch turns this into a `500`.

Impact:

No internal details are returned, but it creates noisy logs and incorrect error classification.

Fix:

- Add a safe decode helper.
- Return `400 malformed_resource_type` for invalid percent-encoding.

Tests:

- `/v1/accounts/0x1/resource/%E0%A4%A` returns `400`.
- Upstream is not called.

### L3. Upstream RPC Errors Can Be Logged Without Enough Redaction

Affected files:

- `packages/movehat/src/fork/api.ts`
- `packages/movehat/src/fork/server.ts`

Issue:

The API client includes upstream response bodies in error messages. The view proxy sanitizes the message for the client but logs raw error text server-side.

Impact:

If an upstream server reflects an Authorization header, API key, query token, control characters, or a large body, logs can contain sensitive or noisy data.

Fix:

- Apply `redactSecrets()` to upstream error bodies.
- Redact the configured `apiKey` literal when present.
- Log sanitized/capped messages, not raw upstream text.

Tests:

- Fake upstream returns body containing `Bearer <key>`, newline, and private-key-shaped values.
- Client response and logs contain redacted/capped text.

### L4. Fork Storage Does Not Force Restrictive Permissions

Affected file:

- `packages/movehat/src/fork/storage.ts`

Issue:

Fork metadata, accounts, and resource JSON are written with default filesystem permissions. Unlike the account pool, fork storage does not force `0o700` directories or `0o600` files.

Impact:

For public mainnet/testnet data, risk is low. For private/auth-gated networks, fork snapshots may contain sensitive resource/account state.

Fix:

- Create fork directories with `0o700` and chmod after creation.
- Write JSON files with `0o600` and chmod after write.

Tests:

- POSIX stat checks for fork root, `resources`, `cache`, `metadata.json`, `accounts.json`, and resource JSON.

### L5. `fork create --name` Needs Traversal Validation

Affected file:

- `packages/movehat/src/commands/fork/create.ts`

Issue:

`options.name` is joined into `.movehat/forks/<name>` without the same safe-name validation used for deployments. A name like `../../outside` can escape the intended fork directory unless `options.path` is explicitly intended to support arbitrary locations.

Impact:

Local file placement outside `.movehat/forks` and confusing overwrite prompts. This is local-user initiated, but it violates path expectations.

Fix:

- Validate `options.name` with a safe-name helper before joining.
- Keep `options.path` as the explicit escape hatch for custom paths.

Tests:

- `--name ../../outside` rejects before constructing `ForkManager`.
- Valid names like `mainnet-fork`, `fork_1`, and `Fork123` still work.

### L6. Raw Unlabelled `0x` Private Keys Are Not Fully Redacted

Affected file:

- `packages/movehat/src/utils/redact.ts`

Issue:

Current redaction covers `ed25519-priv-0x...` and labelled private-key values, but not every raw `0x` + 64 hex string if it appears without label.

Impact:

Over-redacting all 32-byte hex values could hide tx hashes and addresses, so this is a careful hardening issue rather than an obvious bug.

Fix:

- Add contextual redaction for raw 32-byte hex values near words like `private`, `secret`, `signer`, `ed25519`, or known sensitive flags.
- Redact args associated with sensitive flags.

Tests:

- Raw key near `private key` is redacted.
- Tx hashes and account addresses in ordinary contexts are preserved.

### L7. `SECURITY.md` Advisory Notes Are Stale

Affected file:

- `SECURITY.md`

Issue:

The policy documents known advisories as of an earlier date and states that the published `movehat` package has zero advisories. The current audit still shows 0 critical advisories, but the broader workspace advisory set has changed.

Impact:

Disclosure/process risk. Maintainers may believe the known advisory list is complete when it is not.

Fix:

- Update `SECURITY.md` from current audit data.
- Separate:
  - published `packages/movehat`;
  - docs;
  - workspace root;
  - dev-only vs production.

### L8. Inherited-Stdio Commands Can Run Without Timeout

Affected file:

- `packages/movehat/src/utils/childProcessAdapter.ts`

Issue:

The adapter intentionally disables default timeout when `inheritStdio` is true. This is appropriate for watch/interactive flows, but non-watch test/script paths can hang indefinitely.

Impact:

Local availability and CI hangs.

Fix:

- Add explicit configurable timeouts for non-watch inherited-stdio commands.
- Keep watch mode unbounded.

Tests:

- Non-watch test path times out with controlled child lifecycle.
- Watch mode remains unbounded.

## Informational Trust Boundaries

### I1. `movehat run` Executes User Project Code With Full Environment

This is expected behavior for a development framework, but it must remain explicit. A user should not run scripts from an untrusted repository with `PRIVATE_KEY` or other secrets loaded.

Suggested documentation:

- State that `movehat run` and TypeScript tests execute project code with inherited environment variables.
- Recommend using separate throwaway keys for untrusted examples.
- Consider a future `--no-private-env` or env allowlist mode.

### I2. `movehat.config.ts/js` Executes Code From the Current Project

`loadUserConfig()` dynamically imports `movehat.config.ts` or `movehat.config.js`. This is expected for JS tooling and already documented in code as trusted cwd execution.

Suggested documentation:

- Document that running Movehat in an untrusted project can execute code before any transaction occurs.
- Consider redacting secret-shaped strings if config loading throws and wraps an error message.

## False Positives Rejected

### Shell Injection Through Path or Args

Rejected. Production process execution uses `spawn(command, args)` without `shell: true`. Path/profile validation exists for several user-controlled path-like values. Dangerous shell metacharacters are passed literally as argv, not interpreted by a shell.

### Private Key in argv

Rejected. Publish/script/code-object flows pass private keys through `--private-key-file`, not raw argv. Temp files are written with `0o600` and cleanup hooks.

### Wildcard CORS

Rejected. The fork server does not emit `Access-Control-Allow-Origin: *`; it only echoes allowlisted origins.

### LAN Exposure by Default

Rejected. The fork server defaults to `127.0.0.1`; custom host binding can expose the server, and the server warns for `0.0.0.0`.

### `forkApiKey` Persisted to Disk

Rejected. The API key is held in memory and used for Authorization headers. It is not written into fork metadata.

### Docs Raw Routes Path Traversal

Rejected. Docs raw routes serve known docs content through the docs source system. No traversal or secret leak was confirmed.

### Dynamic Config Execution as a Vulnerability

Rejected as a vulnerability by itself. It is an expected local-tool trust boundary. It remains important documentation and threat-model context.

## Existing Security Coverage Confirmed

The test suite already covers several important controls:

- `runCli` redacts stdout/stderr and `CliExecutionError` args.
- `childProcessAdapter` covers timeout, abort, ENOENT, inherited stdio, and maxBuffer basics.
- Shell/path helper tests reject shell metacharacters in validated path/profile contexts.
- `AccountManager` tests assert account pool file and directory permissions.
- `movementProfile` tests assert temp key file mode and cleanup helpers.
- Deploy/harness tests cover private-key redaction, no `~/.aptos/config.yaml` mutation, concurrent temp key files, and SIGINT cleanup.
- Fork server tests cover default bind, custom host, no default CORS, allowlisted CORS, and `/v1/view` proxy behavior.
- Fork storage tests cover address filename sanitization and path traversal rejection for address-derived filenames.
- Config tests cover mtime cache invalidation, network/account resolution, and mainnet-like no-account rejection.

## Recommended Fix Backlog

Suggested order:

1. Resolve `movement` to a trusted absolute path and sanitize Movement CLI environments.
2. Fix child process lifecycle on timeout/abort/maxBuffer overflow.
3. Block untrusted Origin requests before fork server routing and enforce HTTP methods.
4. Prevent imported private keys from being saved by `saveAccountPool()` by default.
5. Tighten npm package contents and add pack-content denylist checks.
6. Add publish-time dependency audit policy and remove or justify root `http-proxy`.
7. Harden fork storage permissions and corrupt JSON/schema handling.
8. Sanitize upstream RPC error logs.
9. Validate `fork create --name`.
10. Update `SECURITY.md`.

## Remediation Test Plan

Security remediation should include these scenarios:

- Fake `movement` earlier in `PATH` is refused or requires opt-in.
- Explicit trusted Movement binary override works.
- Movement CLI subprocess env does not receive `PRIVATE_KEY` or representative token variables.
- User-code subprocess env behavior is documented and tested.
- Child process that traps `SIGTERM` is eventually `SIGKILL`ed.
- Timeout, abort, and maxBuffer paths do not leave child processes running.
- Untrusted Origin returns `403` on ledger, account, resource, resources, and view endpoints.
- Wrong HTTP method returns `405` without fetching upstream.
- Malformed percent-encoding returns `400`.
- Upstream error containing token-like and key-like values is redacted in logs and responses.
- Imported private key is not saved in account pool by default.
- Generated test accounts still persist as expected.
- Fork storage files and directories have expected restrictive permissions.
- `fork create --name ../../outside` rejects before filesystem writes.
- npm pack dry-run does not include source, tests, fixtures, or source maps unless deliberately allowlisted.
- Release workflow fails on disallowed root or `packages/movehat` production advisories.

## Appendix: Audit Artifacts and Limitations

Local limitations:

- Sandbox blocked localhost listeners and `tsx` IPC in the full unit suite. These failures were environment-specific `EPERM` errors.
- The local `npm pack --dry-run` command failed due to `~/.npm` cache ownership/permissions. A sub-agent reran pack dry-run with a temporary npm cache and `--ignore-scripts`.
- The repository had an untracked `grant/` directory. It was out of scope.

Sub-agent outcomes:

- Command execution audit confirmed Medium findings for `PATH`, env inheritance, and process lifecycle.
- Secrets/storage audit confirmed Medium accidental persistence of imported keys plus low redaction/storage hardening.
- Fork/RPC audit confirmed Medium local-service abuse via untrusted Origins plus low HTTP method, decode, logging, and schema/storage issues.
- Supply-chain audit confirmed Medium package contents and release audit gate issues.
- Test coverage audit mapped existing coverage and identified missing tests for the above remediation work.
