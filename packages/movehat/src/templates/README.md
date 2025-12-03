# {{PROJECT_NAME}}

A Move smart contract project built with Movehat.

## Prerequisites

- Node.js v18+
- [Movement CLI](https://docs.movementnetwork.xyz/devs/movementCLI)

## Getting Started

### 1. Install dependencies

\`\`\`bash
npm install
\`\`\`

### 2. Configure environment

Copy \`.env.example\` to \`.env\` and fill in your credentials:

\`\`\`bash
cp .env.example .env
\`\`\`

Edit \`.env\`:
\`\`\`
MH_PRIVATE_KEY=your_private_key_here
MH_ACCOUNT=your_account_address_here
MH_NETWORK=testnet
\`\`\`

### 3. Update Move.toml

Edit \`move/Move.toml\` and set the \`counter\` address to your account address:

\`\`\`toml
[addresses]
counter = "0xYOUR_ACCOUNT_ADDRESS"
\`\`\`

### 4. Compile contracts

\`\`\`bash
npm run compile
\`\`\`

### 5. Deploy

\`\`\`bash
npx tsx scripts/deploy-counter.ts
\`\`\`

Or use the Movement CLI directly:
\`\`\`bash
movement move publish --package-dir ./move --profile default --assume-yes
\`\`\`

### 6. Run tests

\`\`\`bash
npm test
\`\`\`

## Project Structure

\`\`\`
{{PROJECT_NAME}}/
├── move/                   # Move smart contracts
│   ├── sources/
│   │   └── Counter.move
│   └── Move.toml
├── scripts/                # Deployment scripts
│   └── deploy-counter.ts
├── tests/                  # Integration tests
│   └── Counter.test.ts
├── movehat.config.ts       # Movehat configuration
└── .env                    # Environment variables (git-ignored)
\`\`\`

## Available Commands

- \`npm run compile\` - Compile Move contracts
- \`npm test\` - Run integration tests
- \`npm run test:watch\` - Run tests in watch mode
- \`npx tsx scripts/deploy-counter.ts\` - Deploy and initialize counter

## Learn More

- [Movement Documentation](https://docs.movementnetwork.xyz)
- [Aptos Move Book](https://move-language.github.io/move/)
- [Movehat GitHub](https://github.com/gilbertsahumada/movehat)