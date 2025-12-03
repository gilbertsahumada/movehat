<!-- Copilot / AI agent instructions for the Movehat repo -->
# Movehat — AI coding assistant quick guide

This file gives focused, actionable hints for AI coding agents working in this repository so they can be productive immediately.

1) Big picture
- Purpose: a small TypeScript CLI wrapper (named `movehat`) that helps compile, deploy and test Move smart-contract packages using the Movement CLI and Aptos tooling.
- Major parts:
  - `src/` — TypeScript CLI entrypoint (`src/cli.ts`) and command handlers (`src/commands/*.ts`). CLI uses `commander` and exports `deploy`, `compile`, `test` commands.
  - `src/movehat.config.ts` — environment-driven config (uses `dotenv`) with keys: `network`, `rpc`, `profile`, `account`, `privateKey`, `moveDir`, `namedAddresses`.
  - `move/` — Move package root with `Move.toml` and `move/Sources/*.move` sources (e.g. `hello_blockchain.move`).
  - `tests/` — mixed tests. There are Move test expectations (the CLI `test` looks for `.move` files) and a TypeScript integration test (`tests/Counter.test.ts`) that calls Aptos RPC via `@aptos-labs/ts-sdk`.

2) How the repo runs and developer workflows (precise commands)
- Development CLI (live): `npm run dev` — runs `ts-node src/cli.ts`.
- Compile via CLI: `npm run compile` or `npx ts-node src/cli.ts compile`. That calls `movement move build --package-dir ${moveDir}` (see `src/commands/compile.ts`). Ensure `movement` CLI is installed and on PATH.
- Deploy: `npx ts-node src/cli.ts deploy`. This runs `movement move publish --profile ${profile} --package-dir ${moveDir} --assume-yes` from `src/commands/deploy.ts`.
- Run TypeScript integration test: `npx ts-node tests/Counter.test.ts` (the repo `package.json` has no working `test` script — running this file with `ts-node` is the straightforward path).
- Move tests (if present): put `.move` test files under `tests/` (root) and run `npx ts-node src/cli.ts test` — current `test` command expects `.move` files and will import them; it's a minimal test runner stub.

3) Required environment and external tools
- Environment variables (from `src/movehat.config.ts` — loaded via `dotenv`): `MH_ACCOUNT`, `MH_PRIVATE_KEY` (these are used by tests and deploy flows). If missing, some commands will throw or misbehave.
- External CLIs: `movement` (Movement CLI) must be installed and in PATH for `compile` and `deploy` commands to work.
- Node/TS: project uses ESM settings (`module: nodenext`) and `ts-node` for development. Imports use `.js` extensions (e.g. `import config from "../movehat.config.js"`) so prefer running with `ts-node`/ts-node-dev or compile to `dist/` before running with node.

4) Project-specific patterns and conventions
- ESM + TS: files are authored in TypeScript but code imports `.js` extensions to accommodate ESM resolution. When adding imports inside `src/`, follow the same pattern: use `.js` extension in import paths (the project expects runtime `.js` names under `dist/`).
- Config shape: `src/movehat.config.ts` exports a default plain object. Commands import `../movehat.config.js` (or `../src/movehat.config.js` from tests). Keep exported keys stable (`moveDir`, `profile`, `namedAddresses`, `account`, `privateKey`).
- Movement CLI usage: `src/commands/compile.ts` builds a `namedAddresses` string when available. If you change address handling, update both the `compile` command and `src/movehat.config.ts` usage.
- Tests: there are two types of tests here: Move tests (`*.move`) and TypeScript tests (`*.ts`). Don't assume `npm test` is wired — prefer direct `ts-node` invocations.

5) Integration points to be careful about
- RPC and SDK: `tests/Counter.test.ts` uses `@aptos-labs/ts-sdk` and reads `network`/`rpc` from `src/movehat.config.ts`. Changing config keys or the shape will break tests.
- Child-process calls: `compile` and `deploy` use `child_process.exec`. Those calls require the `movement` CLI and rely on string interpolation. Sanitize/validate values if you refactor to avoid shell-injection issues.

6) Examples and quick references (copy-paste)
- Compile (CLI): `npx ts-node src/cli.ts compile`
- Deploy (CLI): `npx ts-node src/cli.ts deploy`
- Run type-test: `npx ts-node tests/Counter.test.ts`
- Movement CLI equivalent: `movement move build --package-dir ./move` and `movement move publish --profile default --package-dir ./move --assume-yes`
- Config file: `src/movehat.config.ts` — example namedAddress usage: `namedAddresses: { counter: process.env.MH_ACCOUNT ?? "0x0" }`.

7) Editing guidance for AI agents
- When editing command handlers in `src/commands/*` maintain the existing `import config from "../movehat.config.js"` pattern and `.js` extensions.
- If you add new CLI commands, register them in `src/cli.ts` using `program.command('<name>').action(<fn>)` to keep parity with existing commands.
- Tests: if you add a new TypeScript test, keep it runnable via `ts-node` (prefer `npx ts-node tests/<file>.ts`). If you add Move tests, place them under `tests/` with `.move` extension to be picked up by the existing `test` command stub.

8) TODOs for maintainers (notes agents can suggest)
- Wire `package.json` `test` script to run `ts-node` tests or add a small runner. (Currently `test` errors out.)
- Consider publishing a `build` script that runs `tsc` to produce `dist/` for the `bin` entry to work.

If anything in this guide is unclear or you want more examples (e.g., a suggested `package.json` `test` script or a `build` + `release` workflow), tell me which areas to expand.
