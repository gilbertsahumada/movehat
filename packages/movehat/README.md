cat > packages/movehat/README.md << 'EOF'
# Movehat

> Hardhat-like development framework for Movement L1 and Aptos Move smart contracts

[![npm version](https://badge.fury.io/js/movehat.svg)](https://www.npmjs.com/package/movehat)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Quick Start** - Scaffold new Move projects in seconds
- **TypeScript Testing** - Write integration tests with familiar tools (Mocha, Chai)
- **Built-in Helpers** - Interact with contracts easily
- **Movement CLI Integration** - Seamless compilation and deployment
- **Hot Reload** - Test changes instantly with watch mode

## Installation

\`\`\`bash
npm install -g movehat
# or
pnpm add -g movehat
\`\`\`

## Quick Start

\`\`\`bash
# Create a new project
npx movehat init my-move-project

# Navigate to project
cd my-move-project

# Install dependencies
npm install

# Compile contracts
npx movehat compile

# Deploy contracts
npx movehat deploy

# Run tests
npm test
\`\`\`

## Project Structure

\`\`\`
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
\`\`\`

## Configuration

Edit `movehat.config.ts`:

\`\`\`typescript
export default {
  network: "movement-testnet",
  rpc: "https://testnet.movementnetwork.xyz/v1",
  account: process.env.MH_ACCOUNT || "",
  privateKey: process.env.MH_PRIVATE_KEY || "",
  moveDir: "./move",
  namedAddresses: {
    counter: process.env.MH_ACCOUNT ?? "0x0",
  },
};
\`\`\`

Set up your environment variables in `.env`:

\`\`\`bash
MH_PRIVATE_KEY=your_private_key_here
MH_ACCOUNT=your_account_address_here
MH_NETWORK=testnet
\`\`\`

## Writing Tests

\`\`\`typescript
import { describe, it, before } from "mocha";
import { expect } from "chai";
import { setupTestEnvironment, getContract, assertTransactionSuccess } from "movehat/helpers";
import type { TestEnvironment, MoveContract } from "movehat/helpers";

describe("Counter Contract", () => {
  let env: TestEnvironment;
  let counter: MoveContract;

  before(async function () {
    this.timeout(30000);
    env = await setupTestEnvironment();
    counter = getContract(
      env.aptos,
      env.account.accountAddress.toString(),
      "counter"
    );
  });

  it("should increment counter", async function () {
    this.timeout(30000);
    
    const tx = await counter.call(env.account, "increment", []);
    assertTransactionSuccess(tx);
    
    const value = await counter.view<number>("get", [
      env.account.accountAddress.toString()
    ]);
    
    expect(value).to.be.greaterThan(0);
  });
});
\`\`\`

## Writing Deployment Scripts

\`\`\`typescript
import { setupTestEnvironment, getContract } from "movehat/helpers";

async function main() {
  console.log("Deploying Counter contract...\n");

  const env = await setupTestEnvironment();
  
  const counter = getContract(
    env.aptos,
    env.account.accountAddress.toString(),
    "counter"
  );

  console.log(\`Contract address: \${env.account.accountAddress.toString()}::counter\`);
  
  // Initialize the counter
  console.log("\nInitializing counter...");
  const txResult = await counter.call(env.account, "init", []);
  
  console.log(\`Transaction hash: \${txResult.hash}\`);
  console.log(\`Counter initialized successfully!\`);
  
  // Verify
  const value = await counter.view<number>("get", [
    env.account.accountAddress.toString()
  ]);
  
  console.log(\`\nInitial counter value: \${value}\`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
\`\`\`

## API Reference

### Helpers

#### \`setupTestEnvironment()\`

Sets up the test environment with Aptos client and account.

\`\`\`typescript
const env = await setupTestEnvironment();
// Returns: { aptos: Aptos, account: Account, config: MovehatConfig }
\`\`\`

#### \`getContract(aptos, moduleAddress, moduleName)\`

Creates a contract wrapper for easy interaction.

\`\`\`typescript
const counter = getContract(aptos, accountAddress, "counter");
\`\`\`

#### \`contract.call(signer, functionName, args, typeArgs)\`

Executes an entry function (transaction).

\`\`\`typescript
const tx = await counter.call(account, "increment", []);
\`\`\`

#### \`contract.view(functionName, args, typeArgs)\`

Reads data from a view function (no transaction).

\`\`\`typescript
const value = await counter.view<number>("get", [address]);
\`\`\`

#### \`assertTransactionSuccess(result)\`

Asserts that a transaction was successful.

\`\`\`typescript
assertTransactionSuccess(txResult);
\`\`\`

## Available Commands

\`\`\`bash
npx movehat compile          # Compile Move contracts
npx movehat deploy          # Deploy contracts
npx movehat test            # Run tests
\`\`\`

## Prerequisites

- Node.js v18+
- [Movement CLI](https://docs.movementnetwork.xyz/devs/movementCLI) installed and configured

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
