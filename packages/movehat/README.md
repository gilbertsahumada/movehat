# Movehat

> Hardhat-like development framework for Movement L1 and Aptos Move smart contracts

[![npm version](https://badge.fury.io/js/movehat.svg)](https://www.npmjs.com/package/movehat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Auto-detection of Named Addresses** - Automatically detects and configures addresses from Move code (like Hardhat)
- **Quick Start** - Scaffold new Move projects in seconds
- **TypeScript Testing** - Write integration tests with familiar tools (Mocha, Chai)
- **Built-in Helpers** - Interact with contracts easily
- **Movement CLI Integration** - Seamless compilation and deployment
- **Hot Reload** - Test changes instantly with watch mode

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

Movehat uses **Transaction Simulation** for testing - no real blockchain or gas costs required:

```typescript
import { describe, it, before } from "mocha";
import { expect } from "chai";
import { getMovehat, type MovehatRuntime } from "movehat";

describe("Counter Contract", () => {
  let mh: MovehatRuntime;
  let contractAddress: string;

  before(async function () {
    this.timeout(30000);

    // Initialize Movehat Runtime Environment
    // Uses Movement testnet by default with auto-generated test accounts
    mh = await getMovehat();
    contractAddress = mh.account.accountAddress.toString();
  });

  it("should initialize counter using simulation", async function () {
    this.timeout(30000);

    // Build transaction
    const transaction = await mh.aptos.transaction.build.simple({
      sender: mh.account.accountAddress,
      data: {
        function: `${contractAddress}::counter::init`,
        functionArguments: []
      }
    });

    // Simulate transaction (no gas cost, instant)
    const [simulation] = await mh.aptos.transaction.simulate.simple({
      signerPublicKey: mh.account.publicKey,
      transaction
    });

    // Verify simulation succeeded
    expect(simulation.success).to.be.true;
    console.log(`Gas used: ${simulation.gas_used}`);
  });
});
```

**Benefits of Transaction Simulation:**
- No blockchain or fork server required
- Instant test execution
- No gas costs
- Perfect for TDD and CI/CD
- Uses Movement testnet with auto-generated accounts by default

## Writing Deployment Scripts

```typescript
import { setupTestEnvironment, getContract } from "movehat/helpers";

async function main() {
  console.log("Deploying Counter contract...\n");

  const env = await setupTestEnvironment();
  
  const counter = getContract(
    env.aptos,
    env.account.accountAddress.toString(),
    "counter"
  );

  console.log(`Contract address: ${env.account.accountAddress.toString()}::counter`);
  
  // Initialize the counter
  console.log("\nInitializing counter...");
  const txResult = await counter.call(env.account, "init", []);
  
  console.log(`Transaction hash: ${txResult.hash}`);
  console.log(`Counter initialized successfully!`);
  
  // Verify
  const value = await counter.view<number>("get", [
    env.account.accountAddress.toString()
  ]);
  
  console.log(`Initial counter value: ${value}`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
```

## API Reference

### Helpers

#### `setupTestEnvironment()`

Sets up the test environment with Aptos client and account.

```typescript
const env = await setupTestEnvironment();
// Returns: { aptos: Aptos, account: Account, config: MovehatConfig }
```

#### `getContract(aptos, moduleAddress, moduleName)`

Creates a contract wrapper for easy interaction.

```typescript
const counter = getContract(aptos, accountAddress, "counter");
```

#### `contract.call(signer, functionName, args, typeArgs)`

Executes an entry function (transaction).

```typescript
const tx = await counter.call(account, "increment", []);
```

#### `contract.view(functionName, args, typeArgs)`

Reads data from a view function (no transaction).

```typescript
const value = await counter.view<number>("get", [address]);
```

#### `assertTransactionSuccess(result)`

Asserts that a transaction was successful.

```typescript
assertTransactionSuccess(txResult);
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
