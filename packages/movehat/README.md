# Movehat

> Hardhat-like development framework for Movement L1 and Aptos Move smart contracts

[![npm version](https://badge.fury.io/js/movehat.svg)](https://www.npmjs.com/package/movehat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Local Node Testing** - Run a real Movement blockchain locally for testing (just like Hardhat!)
- **Dual Testing Modes** - Choose between `local-node` (full blockchain) or `fork` (read-only snapshot)
- **Auto-Deploy in Tests** - Contracts deploy automatically when tests run - zero manual setup
- **setupTestFixture Helper** - High-level API for test setup with type-safe contracts
- **Auto-detection of Named Addresses** - Automatically detects and configures addresses from Move code
- **Quick Start** - Scaffold new Move projects in seconds
- **TypeScript Testing** - Write integration tests with familiar tools (Mocha, Chai)
- **Movement CLI Integration** - Seamless compilation and deployment

## Prerequisites

Before installing Movehat, ensure you have:

- **Node.js v18+** - [Download](https://nodejs.org/)
- **Movement CLI** - **REQUIRED** for compiling Move contracts

  Install from: [Movement CLI Installation Guide](https://docs.movementnetwork.xyz/devs/movementCLI)

  Verify: `movement --version`

**IMPORTANT: Without Movement CLI:** Compilation will fail with "movement: command not found"

## Installation

```bash
npm install -g movehat
# or
pnpm add -g movehat
```

## Quick Start

```bash
# Create a new project
npx movehat init my-move-project

# Navigate to project
cd my-move-project

# Install dependencies
npm install

# Compile contracts (auto-detects named addresses)
npx movehat compile

# Run tests
npm test
```

**Note:** Movehat automatically detects named addresses from your Move files, so no manual configuration is needed for compilation!

## Project Structure

```
my-move-project/
├── move/                   # Move smart contracts
│   ├── sources/
│   │   └── Counter.move
│   └── Move.toml
├── scripts/                # Deployment scripts
│   └── deploy-counter.ts
├── tests/                  # Integration tests
│   └── Counter.test.ts
├── movehat.config.ts       # Configuration
└── .env                    # Environment variables
```

## Configuration

Edit `movehat.config.ts`:

```typescript
export default {
  network: "movement-testnet",
  rpc: "https://testnet.movementnetwork.xyz/v1",
  account: process.env.MH_ACCOUNT || "",
  privateKey: process.env.MH_PRIVATE_KEY || "",
  moveDir: "./move",

  // Named addresses are auto-detected from your Move files
  // Only specify if you need specific production addresses
  namedAddresses: {
    // Optional: counter: "0xYourProductionAddress",
  },
};
```

Set up your environment variables in `.env`:

```bash
MH_PRIVATE_KEY=your_private_key_here
MH_ACCOUNT=your_account_address_here
MH_NETWORK=testnet
```

## Writing Tests

Movehat runs tests on a **real local Movement blockchain** (just like Hardhat!):

```typescript
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { setupTestFixture, teardownTestFixture, type TestFixture } from "movehat/helpers";

describe("Counter Contract", () => {
  let fixture: TestFixture<'counter'>;

  before(async function () {
    this.timeout(60000); // Allow time for local node startup + deployment

    // Setup local testing environment with auto-deployment
    // This will:
    // 1. Start a local Movement blockchain node
    // 2. Generate and fund test accounts from local faucet
    // 3. Auto-deploy the counter module
    // 4. Return everything ready to use
    fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);

    console.log(`\n✅ Testing on local blockchain`);
    console.log(`   Deployer: ${fixture.accounts.deployer.accountAddress.toString()}`);
  });

  it("should initialize with value 0", async () => {
    const counter = fixture.contracts.counter; // Type-safe, no `!` needed
    const deployer = fixture.accounts.deployer;

    // Read counter value (returns string from view function)
    const value = await counter.view<string>("get", [
      deployer.accountAddress.toString()
    ]);

    expect(parseInt(value)).to.equal(0);
  });

  it("should increment counter", async () => {
    const counter = fixture.contracts.counter;
    const deployer = fixture.accounts.deployer;

    // Increment the counter (real transaction on local blockchain!)
    const tx = await counter.call(deployer, "increment", []);
    console.log(`   Transaction: ${tx.hash}`);

    // Read new value
    const value = await counter.view<string>("get", [
      deployer.accountAddress.toString()
    ]);

    expect(parseInt(value)).to.equal(1);
  });

  after(async () => {
    // Cleanup: Stop local node and clear account pool
    await teardownTestFixture();
  });
});
```

**Benefits of Local Node Testing:**
- Real blockchain with actual state changes
- Test real transactions (not just simulations)
- Auto-deploy contracts for each test run
- Type-safe contract access (no `!` operator needed)
- Automatic cleanup after tests
- Just like Hardhat - zero manual setup

## Writing Deployment Scripts

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  console.log("Deploying from:", mh.account.accountAddress.toString());
  console.log("Network:", mh.config.network);

  // Deploy (publish) the module
  // Movehat automatically checks if already deployed
  const deployment = await mh.deployContract("counter");

  console.log("Module deployed at:", deployment.address);
  console.log("Transaction:", deployment.txHash);

  // Get contract instance
  const contract = mh.getContract(deployment.address, "counter");

  // Initialize the counter
  await contract.call(mh.account, "init", []);

  console.log("Counter initialized!");

  // Verify
  const value = await contract.view<string>("get", [
    mh.account.accountAddress.toString()
  ]);

  console.log(`Initial counter value: ${value}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

## API Reference

### Testing Helpers

#### `setupTestFixture(modules, accountLabels, options?)`

High-level API for setting up local testing with auto-deployment. Returns type-safe fixture with contracts and accounts.

```typescript
// Setup with type inference
const fixture = await setupTestFixture(
  ['counter'] as const,  // Modules to deploy
  ['alice', 'bob']       // Additional account labels
);

// Access type-safe contracts (no `!` needed)
const counter = fixture.contracts.counter;

// Access accounts
const deployer = fixture.accounts.deployer;
const alice = fixture.accounts.alice;

// Options (all optional)
const fixture = await setupTestFixture(['counter'] as const, ['alice'], {
  mode: 'fork',                    // 'local-node' (default) or 'fork'
  defaultBalance: 100_000_000,     // Balance per account in octas
  nodeForceRestart: true,          // Restart node on each run
  // ... see LocalTestOptions for more
});
```

#### `setupLocalTesting(options?)`

Lower-level API for setting up local testing environment. Returns MovehatRuntime.

```typescript
import { setupLocalTesting } from "movehat/helpers";

// Local node mode (default) - Full blockchain
const mh = await setupLocalTesting({
  mode: 'local-node',
  accountLabels: ['deployer', 'alice', 'bob'],
  autoDeploy: ['counter'],  // Auto-deploy modules
  autoFund: true,
  defaultBalance: 100_000_000
});

// Fork mode - Read-only snapshot
const mh = await setupLocalTesting({
  mode: 'fork',
  forkNetwork: 'testnet',
  forkName: 'my-fork',
  accountLabels: ['alice', 'bob'],
  // Note: autoDeploy doesn't work in fork mode
});
```

#### `teardownTestFixture()`

Cleanup function to stop local node and clear accounts.

```typescript
after(async () => {
  await teardownTestFixture();
});
```

#### `stopLocalTesting()`

Stops the local testing environment (for lower-level API).

```typescript
await stopLocalTesting();
```

### Contract Interaction

#### `mh.getContract(moduleAddress, moduleName)`

Creates a contract wrapper for easy interaction.

```typescript
const mh = await getMovehat();
const counter = mh.getContract(deployment.address, "counter");
```

#### `contract.call(signer, functionName, args, typeArgs?)`

Executes an entry function (transaction).

```typescript
const tx = await counter.call(account, "increment", []);
console.log(`Transaction: ${tx.hash}`);
```

#### `contract.view<T>(functionName, args, typeArgs?)`

Reads data from a view function (no transaction).

```typescript
// Note: View functions return strings
const value = await counter.view<string>("get", [address]);
console.log(`Value: ${parseInt(value)}`);
```

## Available Commands

```bash
npx movehat compile          # Compile Move contracts
npx movehat deploy          # Deploy contracts
npx movehat test            # Run tests
```

## System Requirements

**Required:**
- Node.js v18+
- Movement CLI - **REQUIRED** ([Installation Guide](https://docs.movementnetwork.xyz/devs/movementCLI))
- npm or pnpm

**What fails without Movement CLI:**
- `movehat compile` → "movement: command not found"
- Contract building and deployment will not work

**Recommended:**
- Git
- VS Code with Move syntax extension

## Documentation

Visit [GitHub Repository](https://github.com/gilbertsahumada/movehat) for full documentation and examples.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © 
## Links

- [Movement Network](https://movementnetwork.xyz)
- [Aptos Move Documentation](https://aptos.dev/move/move-on-aptos/)
- [GitHub Issues](https://github.com/gilbertsahumada/movehat/issues)
