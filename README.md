<div align="center">
  <img src="./packages/movehat/public/movehat.png" alt="Movehat" width="160"/>

  # Movehat

  **A Hardhat-like development framework for Movement L1 smart contracts.**

  Write your tests and deployment scripts in TypeScript while building Move contracts.

  [![NPM Version](https://img.shields.io/npm/v/movehat)](https://www.npmjs.com/package/movehat)
  [![License](https://img.shields.io/npm/l/movehat)](./LICENSE)

  **[Full documentation](https://movehat.org/)**

</div>

---

## Features

- **Hardhat-style Harness API** — `Harness.createLocal`, `createFork`, `createLive` factory methods with explicit lifecycle (`cleanup()`) and use-after-cleanup safety (Proxy poisoning).
- **Three execution modes** — full local blockchain, read-only fork of a remote network, or live testnet/mainnet binding.
- **Auto-deploy in tests + auto-detect named addresses** — contracts compile and deploy automatically; no manual address wiring.
- **Fast local boot with movelite** — on supported platforms an auto-installed [movelite](https://github.com/gilbertsahumada/movelite) binary boots the local test chain in under a second instead of ~15s, with transparent fallback to the full Movement node.
- **Foundry-style execution traces** — raise verbosity (`-vv` … `-vvvv`) to render an indented call tree for each `contract.call(...)` with decoded arguments, gas, events, and the abort stack (full tree on the movelite backend; the Movement node renders a degraded flat trace — events, state changes, and gas).
- **Native fork system** — local JSON-backed snapshots of Movement L1 state, no BCS compatibility issues.
- **TypeScript-first** — single `PRIVATE_KEY` across all networks (Hardhat-style); deployments tracked per-network in `deployments/`.
- **SLSA-provenance releases** — every npm release ships with [Trusted Publishers](https://docs.npmjs.com/trusted-publishers) provenance. Verify with `npm view movehat@<version>`.
- **Security hardening built-in** — path-traversal, command-injection, and YAML-injection protections at every boundary.

## Quick Start

### Prerequisites

- **Node.js v20+** ([download](https://nodejs.org/))
- **Movement CLI** — required for compiling and deploying Move code ([install guide](https://docs.movementnetwork.xyz/devs/movementcli)). For the exact revision Movehat tests against, see [`MOVEMENT_CLI_COMPAT.md`](./MOVEMENT_CLI_COMPAT.md).

### Installation

```bash
npm install -g movehat
# or
pnpm install -g movehat
```

### Five commands to a working test

```bash
npx movehat init my-project    # 1. Scaffold project
cd my-project
npm install                    # 2. Install dependencies
npx movehat compile            # 3. Compile contracts (auto-detects addresses)
npm test                       # 4. Run tests (auto-starts local node, deploys, runs)
```

That's it — local blockchain starts automatically, accounts get funded, contracts deploy, tests run.

For more depth (project layout, configuration, account model, deployment tracking), browse the [full docs](https://movehat.org/).

## Configuration

A minimal `movehat.config.ts` looks like this:

```typescript
import dotenv from "dotenv";
dotenv.config();

export default {
  defaultNetwork: "local",
  networks: {
    testnet: { url: process.env.MOVEMENT_RPC_URL || "https://testnet.movementnetwork.xyz/v1", chainId: "testnet" },
    mainnet: { url: "https://mainnet.movementnetwork.xyz/v1", chainId: "mainnet" },
    local:   { url: "http://localhost:8080/v1", chainId: "local" },
  },
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
  moveDir: "./move",
};
```

A single `PRIVATE_KEY` is reused across networks (Hardhat-style). For testing, accounts are auto-generated and funded from the local faucet — no `.env` needed.

Full reference: [`/docs/getting-started/configuration`](https://movehat.org/docs/getting-started/configuration).

## Writing Tests

The canonical pattern uses `Harness.createLocal`:

```typescript
// tests/Counter.test.ts
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { Harness } from "movehat";
import type { MoveContract } from "movehat/helpers";

describe("Counter Contract", () => {
  let harness: Harness;
  let counter: MoveContract;
  let counterAddr: string;

  before(async function () {
    this.timeout(60000); // Local node startup + autoDeploy

    harness = await Harness.createLocal({
      accountLabels: ["deployer", "alice"],
      autoDeploy: ["counter"],
    });

    counterAddr = harness.runtime.getDeploymentAddress("counter");
    counter = harness.runtime.getContract(counterAddr, "counter");
  });

  after(async () => { await harness.cleanup(); });

  it("alice can increment her own counter", async () => {
    const alice = harness.runtime.getAccountByLabel("alice");
    await counter.call(alice, "increment", []);
    const [value] = await harness.runViewFunction({
      function: `${counterAddr}::counter::get`,
      functionArguments: [alice.accountAddress.toString()],
    });
    expect(parseInt(value as string)).to.equal(1);
  });
});
```

Run with `npm test` (interactive menu) or `movehat test --ts` (TypeScript suite, starts local node).

> `setupTestFixture` from `movehat/helpers` is a lighter-weight alternative for tests that don't need the Harness lifecycle — both styles are documented at [`/docs/guides/testing`](https://movehat.org/docs/guides/testing).

## Writing Deployment Scripts

Deploy safely to a local chain by default, and opt into live networks explicitly:

```typescript
// scripts/deploy-counter.ts
import { Harness } from "movehat";
import config from "../movehat.config.js";

async function main() {
  const network = process.env.MH_CLI_NETWORK
    ?? process.env.MOVEHAT_NETWORK
    ?? process.env.MH_DEFAULT_NETWORK
    ?? config.defaultNetwork
    ?? "local";
  const isLocal = network === "local" || network === "movelite";
  const harness = isLocal
    ? await Harness.createLocal({
        ...(network === "movelite" ? { useMovelite: true } : {}),
        autoDeploy: ["counter"],
      })
    : await Harness.createLive(network);
  try {
    const deployment = isLocal
      ? harness.runtime.getDeployment("counter")
      : await harness.deployCodeObject({ moduleName: "counter" });
    if (!deployment) throw new Error("Counter deployment was not created");
    console.log(`Deployed: ${deployment.address}::counter`);
    console.log(`Tx:       ${deployment.txHash}`);

    // Initialize the freshly deployed module
    const counter = harness.runtime.getContract(deployment.address, "counter");
    await counter.call(harness.runtime.account, "init", []);
  } finally {
    await harness.cleanup();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Run locally with `movehat run scripts/deploy-counter.ts`, or target testnet
explicitly with `movehat run scripts/deploy-counter.ts --network testnet`.

Live re-runs fail with `ModuleAlreadyDeployedError` (recorded at
`deployments/{network}/counter.json`). Set `MH_CLI_REDEPLOY=true` to force a
live re-deploy; the disposable local chain starts clean.

> Requires `movehat@^0.2.0`. Full deploy guide (named addresses, code-object semantics, redeploy flow, deployment tracking): [`/docs/guides/deployment`](https://movehat.org/docs/guides/deployment).

## Fork System

Movehat ships a native fork system for testing against real Movement L1 state without deploying to testnet. Forks are JSON-backed local snapshots that lazy-load resources as you read them, and `Harness.createFork(network)` binds a Harness to one.

Full fork docs: [`FORK_GUIDE.md`](./FORK_GUIDE.md) (in-repo, comprehensive) or [`/docs/guides/fork`](https://movehat.org/docs/guides/fork) (live site).

## CLI Reference

| Command | Description | Docs |
|---|---|---|
| `movehat init [name]` | Scaffold a new Movehat project | [/docs/cli/init](https://movehat.org/docs/cli/init) |
| `movehat compile` | Compile Move contracts via Movement CLI | [/docs/cli/compile](https://movehat.org/docs/cli/compile) |
| `movehat test [--move\|--ts\|--all]` | Run Move and/or TypeScript tests (interactive menu by default) | [/docs/cli/test](https://movehat.org/docs/cli/test) |
| `movehat run <script>` | Execute a TypeScript deployment / interaction script | [/docs/cli/run](https://movehat.org/docs/cli/run) |
| `movehat fork <subcmd>` | Manage local network forks (create / list / serve / fund / view-resource) | [/docs/cli/fork](https://movehat.org/docs/cli/fork) |
| `movehat update` | Check npm for a newer version and upgrade | — |

## Troubleshooting

| Error | Solution |
|---|---|
| `movement: command not found` | Install Movement CLI per [the Movement docs](https://docs.movementnetwork.xyz/devs/movementcli) |
| `Module "X" is already deployed on Y` | Set `MH_CLI_REDEPLOY=true` to force a re-deploy |
| `Configuration file not found` | Create `movehat.config.ts` or run `movehat init` |
| `No accounts configured` | Set `PRIVATE_KEY` in `.env` |
| `Cannot find package 'dotenv'` | Run `npm install` or `pnpm install` in the project dir |

For anything not on this list, open an issue on [GitHub](https://github.com/gilbertsahumada/movehat/issues).

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development setup, the dual-tier test infrastructure, and the PR workflow. See [`MAINTENANCE.md`](./MAINTENANCE.md) for release cadence, triage SLA, versioning, and deprecation policy.

## License

MIT — see [`LICENSE`](./LICENSE).

## Links

- [Full documentation](https://movehat.org/) — guides, CLI reference, auto-generated API reference (50 pages from TypeDoc)
- [Fork system guide](./FORK_GUIDE.md) — in-repo deep-dive
- [GitHub repository](https://github.com/gilbertsahumada/movehat)
- [NPM package](https://www.npmjs.com/package/movehat)
- [Movement Network](https://movementnetwork.xyz/) — the L1 Movehat targets
- [Movement Network docs](https://docs.movementnetwork.xyz/)

## Author

**Gilberts Ahumada**

[![Twitter](https://img.shields.io/badge/Twitter-@gilbertsahumada-1DA1F2?logo=x&logoColor=white)](https://x.com/@gilbertsahumada)
[![YouTube](https://img.shields.io/badge/YouTube-@gilbertsahumada-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@gilbertsahumada)
[![Website](https://img.shields.io/badge/Website-gilbertsahumada.com-blue)](https://gilbertsahumada.com)
