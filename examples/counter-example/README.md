# counter-example

A working Movehat project scaffolded around a minimal Move module (`hello_blockchain::counter`). Each script in `scripts/` exercises a different Movehat primitive end-to-end against the example contract.

## Scripts

| Script | Demonstrates | Network |
|---|---|---|
| `npm run compile` | `movehat compile` — Movement CLI build wrapper. | n/a |
| `npm test` | `Harness.createLocal` + `runViewFunction` + auto-deploy in tests. | local-node |
| `npm run deploy` | `Harness.createLive` + `harness.deployCodeObject` against a real network. | live (`MOVEHAT_NETWORK`, default `testnet`) |
| `npm run upgrade` | `harness.upgradeCodeObject` — re-publishes the package into the existing code object (requires a prior `npm run deploy`). | live |
| `npm run run-script` | `harness.runMoveScript` — submits an on-the-fly compiled Move script as a one-shot tx. | local-node |
| `npm run demo-fork` | Low-level `ForkManager` API — manual init/load + direct resource read/write. | fork |
| `npm run demo-harness-fork` | `Harness.createFork` — high-level factory; read-only `runViewFunction` + write-rejection contract + post-cleanup poisoning via `HarnessDisposedError`. | fork |

## Prerequisites

- Node 20+, npm or pnpm, Movement CLI installed (see [movehat.org docs](https://movehat.org)).
- For `deploy` / `upgrade`: `.env` with `PRIVATE_KEY` and optional `MOVEHAT_NETWORK`.
- For `demo-fork` / `demo-harness-fork`: optional `MOVEMENT_API_KEY` to avoid public-endpoint rate limits.

## Layout

```
counter-example/
├── move/
│   ├── Move.toml
│   ├── sources/        # Move modules (Counter, Greeting, ...)
│   └── scripts/        # One-shot Move scripts (echo.move)
├── scripts/            # TypeScript orchestration scripts
├── tests/              # Mocha test suite (Harness.createLocal + auto-deploy)
└── movehat.config.ts   # Network + accounts config consumed by Movehat
```
