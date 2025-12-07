<div align="center">
  <img src="./packages/movehat/public/movehat.png" alt="Movehat" width="200"/>

  # Movehat

  **A Hardhat-like development framework for Movement L1 and Aptos Move smart contracts**

  Write your tests and deployment scripts in TypeScript while building Move smart contracts.

  [![NPM Version](https://img.shields.io/npm/v/movehat)](https://www.npmjs.com/package/movehat)
  [![License](https://img.shields.io/npm/l/movehat)](./LICENSE)

  ---

  Created by [**@gilbertsahumada**](https://gilbertsahumada.com)

  [![Twitter](https://img.shields.io/badge/Twitter-@gilbertsahumada-1DA1F2?logo=x&logoColor=white)](https://x.com/@gilbertsahumada)
  [![YouTube](https://img.shields.io/badge/YouTube-@gilbertsahumada-FF0000?logo=youtube&logoColor=white)](https://www.youtube.com/@gilbertsahumada)
  [![Website](https://img.shields.io/badge/Website-gilbertsahumada.com-blue)](https://gilbertsahumada.com)

</div>

## Features

- **TypeScript-first** - Write tests and deployment scripts in TypeScript
- **Hardhat-style accounts** - Single `PRIVATE_KEY` works across all networks
- **Multi-network support** - Configure multiple networks (testnet, mainnet, local)
- **Hardhat-like workflow** - Familiar commands and project structure
- **Movehat Runtime Environment** - Global context object similar to Hardhat's HRE
- **Movement CLI integration** - Wraps Movement CLI for compilation and publishing
- **Deployment tracking** - Automatic per-network deployment tracking (like hardhat-deploy)
- **Security-focused** - Built-in protection against path traversal, command injection, and YAML injection

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

Copy `.env.example` to `.env` and add your private key:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Your private key (works on all networks - Hardhat-style)
PRIVATE_KEY=0x1234567890abcdef...

# Optional: Override RPC URL
MOVEMENT_RPC_URL=https://custom-testnet.movementnetwork.xyz/v1
```

**Note:** Like Hardhat, Movehat uses a single `PRIVATE_KEY` that works across all networks (testnet, mainnet, local). This simplifies configuration and matches real-world usage.

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
import dotenv from "dotenv";
dotenv.config();

export default {
  // Default network to use when no --network flag is provided
  defaultNetwork: "testnet",

  // Network configurations
  networks: {
    testnet: {
      url: process.env.MOVEMENT_RPC_URL || "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet",
    },
    mainnet: {
      url: "https://mainnet.movementnetwork.xyz/v1",
      chainId: "mainnet",
    },
    local: {
      url: "http://localhost:8080/v1",
      chainId: "local",
    },
  },

  // Global accounts configuration (Hardhat-style)
  // Uses PRIVATE_KEY from .env by default
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],

  // Move source directory
  moveDir: "./move",

  // Named addresses (optional)
  namedAddresses: {
    // Example: counter: "0x1234...",
  },
};
```

**Key differences from other frameworks:**
- **One account for all networks** - Just like Hardhat, your `PRIVATE_KEY` works across testnet, mainnet, and local
- **Simpler configuration** - Networks only need to define their RPC URL
- **Flexible** - You can still specify different accounts per network if needed by adding `accounts` to a specific network config

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

### Deployment Tracking

Movehat **automatically tracks deployments** per network, similar to hardhat-deploy:

```
my-project/
└── deployments/
    ├── testnet/
    │   ├── counter.json
    │   └── token.json
    ├── mainnet/
    │   └── counter.json
    └── local/
        └── counter.json
```

Each deployment file contains:
```json
{
  "address": "0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9",
  "moduleName": "counter",
  "network": "testnet",
  "deployer": "0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9",
  "timestamp": 1704985623564,
  "txHash": "0x59cb0c2df832064174b50fc69909af5819c6e273cc644f9a2123102b20bb0ef2"
}
```

### Automatic Deployment Check

When you run a deployment script, Movehat **automatically checks** if the module is already deployed:

**First time:**
```bash
movehat run scripts/deploy-counter.ts --network testnet
# ✅ Deploys successfully
```

**Second time (already deployed):**
```bash
movehat run scripts/deploy-counter.ts --network testnet
# ❌ Error: Module "counter" is already deployed on testnet
#    Address: 0x662a...
#    Deployed at: 12/5/2025, 11:38:14 PM
#    Transaction: 0x59cb0c2df832...
#
#    💡 To redeploy, run with the --redeploy flag:
#    movehat run <script> --network testnet --redeploy
```

**Force redeploy:**
```bash
movehat run scripts/deploy-counter.ts --network testnet --redeploy
# ✅ Redeploys and updates deployment info
```

### Available Runtime Properties

```typescript
const mh = await getMovehat();

// Core
mh.config         // Resolved configuration
mh.network        // Network info (name, chainId, rpc)
mh.aptos          // Aptos SDK client
mh.account        // Primary account
mh.accounts       // All configured accounts

// Contract helpers
mh.getContract    // Get contract helper

// Deployment functions
mh.deployContract       // Deploy and track module
mh.getDeployment        // Get deployment info for a module
mh.getDeployments       // Get all deployments for current network
mh.getDeploymentAddress // Get deployed address for a module

// Network management
mh.switchNetwork  // Switch to different network
```

### Using Multiple Accounts

You can configure multiple accounts globally:

```typescript
// movehat.config.ts
export default {
  accounts: [
    process.env.PRIVATE_KEY,        // Primary account
    process.env.SECONDARY_KEY,      // Secondary account
    process.env.TERTIARY_KEY,       // Tertiary account
  ].filter(Boolean),  // Filter out undefined values

  networks: {
    testnet: { url: "..." },
  },
};
```

Then access them in your scripts:

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
  console.log("Third:", thirdAccount.accountAddress.toString());

  // Deploy with secondary account
  const contract = mh.getContract(deployment.address, "counter");
  await contract.call(secondAccount, "init", []);
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

### `movehat run <script> [--network <name>] [--redeploy]`

Execute a TypeScript/JavaScript script with the Movehat Runtime.

```bash
# Run with default network
movehat run scripts/deploy-counter.ts

# Run with specific network
movehat run scripts/deploy-counter.ts --network testnet
movehat run scripts/deploy-counter.ts --network mainnet
movehat run scripts/deploy-counter.ts --network local

# Force redeploy (overrides deployment check)
movehat run scripts/deploy-counter.ts --network testnet --redeploy
```

**Flags:**
- `--network <name>` - Network to use (testnet, mainnet, local, etc.)
- `--redeploy` - Force redeploy even if module is already deployed

**Supported file extensions:** `.ts`, `.js`, `.mjs`

### `movehat test`

Run your TypeScript test suite.

```bash
movehat test
```

This runs your Mocha tests in the `tests/` directory.

## Environment Variables

### Primary Configuration (Hardhat-style)

```bash
# Your wallet private key (works on all networks)
PRIVATE_KEY=0x1234567890abcdef...
```

### Optional Overrides

```bash
# Override RPC URL for current network
MOVEMENT_RPC_URL=https://custom-testnet.movementnetwork.xyz/v1

# Override default network from config
MH_DEFAULT_NETWORK=mainnet

# Override network via environment (alternative to --network flag)
MH_CLI_NETWORK=testnet
```

### Account Resolution Priority

Movehat resolves accounts in this order:
1. **Network-specific accounts** in `movehat.config.ts` (if defined)
2. **Global `accounts`** in `movehat.config.ts` (if defined)
3. **`PRIVATE_KEY`** environment variable
4. Error if none found

**Example:**
```typescript
// movehat.config.ts
export default {
  // Option 1: Global accounts (recommended - Hardhat-style)
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],

  networks: {
    testnet: { url: "..." },

    // Option 2: Network-specific accounts (advanced use case)
    mainnet: {
      url: "...",
      accounts: [process.env.MAINNET_PRIVATE_KEY]  // Different key for mainnet
    },
  },
};
```

## Examples

### Deploy and Initialize

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  // 1. Deploy (publish) the module
  // Automatically checks if already deployed
  const deployment = await mh.deployContract("counter");
  console.log("Module deployed at:", deployment.address);
  console.log("Transaction:", deployment.txHash);

  // 2. Initialize
  const contract = mh.getContract(deployment.address, "counter");
  await contract.call(mh.account, "init", []);

  // 3. Verify
  const value = await contract.view("getValue", []);
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

  // Deploy module - automatically tracked per network
  const deployment = await mh.deployContract("counter");
  console.log(`Deployed on ${mh.config.network}:`, deployment.address);
}

main().catch(console.error);
```

### Using Deployment Info

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  // Check if already deployed
  const existing = mh.getDeployment("counter");
  if (existing) {
    console.log("Already deployed at:", existing.address);
    console.log("Deployed on:", new Date(existing.timestamp).toLocaleString());
    console.log("TX:", existing.txHash);

    // Use existing deployment
    const contract = mh.getContract(existing.address, "counter");
    // ... interact with contract
    return;
  }

  // Deploy new
  const deployment = await mh.deployContract("counter");
  // ... initialize
}

main().catch(console.error);
```

### Get All Deployments

```typescript
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  // Get all deployments for current network
  const deployments = mh.getDeployments();

  for (const [moduleName, info] of Object.entries(deployments)) {
    console.log(`${moduleName}: ${info.address}`);
    console.log(`  TX: ${info.txHash}`);
    console.log(`  Deployed: ${new Date(info.timestamp).toLocaleString()}`);
  }
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

Movehat provides helpful suggestions when no accounts are found:

```
Network 'testnet' has no accounts configured.
Options:
  1. Set PRIVATE_KEY in your .env file (recommended)
  2. Add 'accounts: ["0x..."]' globally in movehat.config.ts
  3. Add 'accounts: ["0x..."]' to the 'testnet' network config
```

**Solution (recommended):**
```bash
# Add to .env file
echo "PRIVATE_KEY=0x1234567890abcdef..." >> .env
```

**Alternative - In config:**
```typescript
// movehat.config.ts
export default {
  accounts: ["0x1234567890abcdef..."],
  // ... rest of config
};
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

**Gilberts Ahumada**

- Website: [gilbertsahumada.com](https://gilbertsahumada.com)
- Twitter/X: [@gilbertsahumada](https://x.com/@gilbertsahumada)
- YouTube: [@gilbertsahumada](https://www.youtube.com/@gilbertsahumada)
- GitHub: [@gilbertsahumada](https://github.com/gilbertsahumada)
