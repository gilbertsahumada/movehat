# Movehat

A Hardhat-like development framework for Movement L1 and Aptos Move smart contracts.

Write your tests and deployment scripts in TypeScript while building Move smart contracts.

## Features

- **TypeScript-first** - Write tests and deployment scripts in TypeScript
- **Multi-network support** - Configure multiple networks (testnet, mainnet, local)
- **Hardhat-like workflow** - Familiar commands and project structure
- **Movehat Runtime Environment** - Global context object similar to Hardhat's HRE
- **Movement CLI integration** - Wraps Movement CLI for compilation and publishing

## Installation

```bash
npm install -g movehat
# or
pnpm install -g movehat
```

## Quick Start

### 1. Initialize a new project

```bash
mkdir my-move-project
cd my-move-project
movehat init
```

This creates the following structure:

```
my-move-project/
├── move/                     # Move smart contracts
│   ├── Move.toml
│   └── sources/
│       └── Counter.move
├── scripts/                  # Deployment scripts (TypeScript)
│   └── deploy-counter.ts
├── tests/                    # Test files (TypeScript)
│   └── Counter.test.ts
├── movehat.config.ts         # Movehat configuration
├── .env.example
├── package.json
└── tsconfig.json
```

### 2. Configure your environment

Copy `.env.example` to `.env` and add your private keys:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Testnet
MH_TESTNET_PRIVATE_KEY=0x1234...
MH_TESTNET_RPC=https://testnet.movementnetwork.xyz/v1

# Mainnet
MH_MAINNET_PRIVATE_KEY=0x5678...
MH_MAINNET_RPC=https://mainnet.movementnetwork.xyz/v1

# Local development
MH_LOCAL_PRIVATE_KEY=0x9abc...
```

### 3. Install dependencies

```bash
npm install
# or
pnpm install
```

### 4. Compile your contracts

```bash
movehat compile
```

### 5. Run deployment scripts

```bash
# Deploy to testnet (default)
movehat run scripts/deploy-counter.ts

# Deploy to specific network
movehat run scripts/deploy-counter.ts --network mainnet
movehat run scripts/deploy-counter.ts --network local
```

### 6. Run tests

```bash
npm test
# or
pnpm test
```

## Configuration

### Network Configuration

Edit `movehat.config.ts` to configure your networks:

```typescript
export default {
  defaultNetwork: "testnet",

  networks: {
    testnet: {
      url: process.env.MH_TESTNET_RPC || "https://testnet.movementnetwork.xyz/v1",
      accounts: [process.env.MH_TESTNET_PRIVATE_KEY || ""],
      chainId: "testnet",
      profile: "default",
    },
    mainnet: {
      url: process.env.MH_MAINNET_RPC || "https://mainnet.movementnetwork.xyz/v1",
      accounts: [process.env.MH_MAINNET_PRIVATE_KEY || ""],
      chainId: "mainnet",
    },
    local: {
      url: "http://localhost:8080/v1",
      accounts: [process.env.MH_LOCAL_PRIVATE_KEY || ""],
    },
  },

  moveDir: "./move",

  namedAddresses: {
    counter: process.env.MH_ACCOUNT || "0x0",
  },
};
```

### Network Selection Priority

Movehat selects networks in this order:

1. `--network` CLI flag
2. `MH_CLI_NETWORK` environment variable
3. `MH_DEFAULT_NETWORK` environment variable
4. `defaultNetwork` in config
5. `"testnet"` (fallback)

## Writing Deployment Scripts

Deployment scripts use the **Movehat Runtime Environment (MRE)**:

```typescript
// scripts/deploy-counter.ts
import { getMovehat } from "movehat";

async function main() {
  // Get the Movehat Runtime Environment
  const mh = await getMovehat();

  console.log("Deploying from:", mh.account.accountAddress.toString());
  console.log("Network:", mh.config.network);

  // Your deployment logic here
  const contract = mh.getContract(mh.account, "counter");

  // Initialize the counter
  await contract.init();

  console.log("Counter deployed!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### Available Runtime Properties

```typescript
const mh = await getMovehat();

mh.config         // Resolved configuration
mh.network        // Network info (name, chainId, rpc)
mh.aptos          // Aptos SDK client
mh.account        // Primary account
mh.accounts       // All configured accounts
mh.getContract    // Get contract helper
mh.switchNetwork  // Switch to different network
```

### Using Multiple Accounts

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  // Use primary account (accounts[0])
  console.log("Primary:", mh.account.accountAddress.toString());

  // Access other accounts
  const secondAccount = mh.accounts[1];
  console.log("Second:", secondAccount.accountAddress.toString());

  // Or use helper
  const thirdAccount = mh.getAccountByIndex(2);
}
```

## Writing Tests

Tests use Mocha and Chai with the Movehat Runtime:

```typescript
// tests/Counter.test.ts
import { expect } from "chai";
import { getMovehat } from "movehat";

describe("Counter", () => {
  let mh: any;

  before(async () => {
    mh = await getMovehat();
  });

  it("should initialize counter", async () => {
    const contract = mh.getContract(mh.account, "counter");
    await contract.init();

    const value = await contract.getValue();
    expect(value).to.equal(0);
  });

  it("should increment counter", async () => {
    const contract = mh.getContract(mh.account, "counter");
    await contract.increment();

    const value = await contract.getValue();
    expect(value).to.equal(1);
  });
});
```

## CLI Commands

### `movehat init [project-name]`

Initialize a new Movehat project.

```bash
movehat init my-project
movehat init  # Uses current directory
```

### `movehat compile`

Compile Move smart contracts using Movement CLI.

```bash
movehat compile
```

**Note:** Compilation is network-independent and uses global configuration.

### `movehat run <script> [--network <name>]`

Execute a TypeScript/JavaScript script with the Movehat Runtime.

```bash
# Run with default network
movehat run scripts/deploy-counter.ts

# Run with specific network
movehat run scripts/deploy-counter.ts --network testnet
movehat run scripts/deploy-counter.ts --network mainnet
movehat run scripts/deploy-counter.ts --network local
```

Supported file extensions: `.ts`, `.js`, `.mjs`

### `movehat test`

Run your TypeScript test suite.

```bash
movehat test
```

This runs your Mocha tests in the `tests/` directory.

## Environment Variables

### Per-Network Private Keys

```bash
MH_TESTNET_PRIVATE_KEY=0x...   # Testnet private key
MH_MAINNET_PRIVATE_KEY=0x...   # Mainnet private key
MH_LOCAL_PRIVATE_KEY=0x...     # Local private key
```

### Per-Network RPC URLs

```bash
MH_TESTNET_RPC=https://...     # Custom testnet RPC
MH_MAINNET_RPC=https://...     # Custom mainnet RPC
```

### Global Settings

```bash
MH_PRIVATE_KEY=0x...           # Fallback private key (if network has no accounts)
MH_CLI_NETWORK=testnet         # Override default network
MH_DEFAULT_NETWORK=mainnet     # Set default network
```

## Examples

### Deploy and Initialize

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  // 1. Publish module (handled by Movement CLI internally)
  console.log("Publishing module...");

  // 2. Initialize
  const contract = mh.getContract(mh.account, "counter");
  await contract.init();

  // 3. Verify
  const value = await contract.getValue();
  console.log("Initial value:", value);
}

main().catch(console.error);
```

### Multi-Network Deployment

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  if (mh.config.network === "mainnet") {
    console.log("⚠️  Deploying to MAINNET");
    // Add confirmation logic
  }

  // Deploy logic here
}

main().catch(console.error);
```

### Using Named Addresses

```typescript
// movehat.config.ts
export default {
  namedAddresses: {
    deployer: process.env.MH_DEPLOYER_ADDRESS,
    counter: process.env.MH_COUNTER_ADDRESS,
  },
  // ... rest of config
};

// In your script
const mh = await getMovehat();
console.log("Deployer:", mh.config.namedAddresses.deployer);
console.log("Counter:", mh.config.namedAddresses.counter);
```

## Project Structure Best Practices

```
my-project/
├── move/
│   ├── Move.toml
│   └── sources/
│       ├── Counter.move
│       ├── Token.move
│       └── ...
├── scripts/
│   ├── deploy-counter.ts
│   ├── deploy-token.ts
│   ├── initialize.ts
│   └── ...
├── tests/
│   ├── Counter.test.ts
│   ├── Token.test.ts
│   └── integration/
│       └── ...
├── movehat.config.ts
├── .env
├── .env.example
└── package.json
```

## Troubleshooting

### "Configuration file not found"

Make sure you have `movehat.config.ts` or `movehat.config.js` in your project root.

### "Network 'X' not found in configuration"

Check that the network is defined in your `movehat.config.ts`:

```typescript
networks: {
  testnet: { /* ... */ },
  mainnet: { /* ... */ },
}
```

### "Network 'X' has no accounts configured"

Set the private key environment variable:

```bash
# For testnet
export MH_TESTNET_PRIVATE_KEY=0x...

# Or add to .env file
echo "MH_TESTNET_PRIVATE_KEY=0x..." >> .env
```

### "Module not found"

Make sure you've compiled your contracts first:

```bash
movehat compile
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

MIT

## Links

- [GitHub Repository](https://github.com/gilbertsahumada/movehat)
- [NPM Package](https://www.npmjs.com/package/movehat)
- [Movement Documentation](https://docs.movementlabs.xyz/)
- [Aptos SDK](https://aptos.dev/sdks/ts-sdk/)

## Author

Gilberts Ahumada
