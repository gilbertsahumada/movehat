# counter-example

A working Movehat project scaffolded around several Move modules under the `hello_blockchain` named address — `counter`, `greeting`, `message` (each with its own test spec), plus `registry` (source only, used by the [multi-contract tutorial](https://movehat.org/docs/guides/multi-contract)). Each script in `scripts/` exercises a different Movehat primitive end-to-end against the example contracts.

## Scripts

| Script | Demonstrates | Network |
|---|---|---|
| `npm run compile` | `movehat compile` — Movement CLI build wrapper. | n/a |
| `npm test` | `Harness.createLocal` + `runViewFunction` + auto-deploy in tests. | local-node |
| `npm run deploy` | `Harness.createLocal` by default; set `MOVEHAT_NETWORK` to opt into `Harness.createLive`. | local (default) or live |
| `npm run upgrade` | `harness.upgradeCodeObject` — re-publishes the package into the existing code object (requires a prior `npm run deploy` on the same live network, e.g. `MOVEHAT_NETWORK=testnet` for both). | live |
| `npm run run-script` | `harness.runMoveScript` — submits an on-the-fly compiled Move script as a one-shot tx. | local-node |
| `npm run demo-fork` | Low-level `ForkManager` API — manual init/load + direct resource read/write. | fork |
| `npm run demo-harness-fork` | `Harness.createFork` — high-level factory; read-only `runViewFunction` + write-rejection contract + post-cleanup poisoning via `HarnessDisposedError`. | fork |

## Prerequisites

- Node 20+, npm or pnpm, Movement CLI installed (see [movehat.org docs](https://movehat.org)).
- The default `deploy` is local and needs no credentials. For public-network
  `deploy` / `upgrade`, set `MOVEHAT_NETWORK` and provide `PRIVATE_KEY` in `.env`.
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
