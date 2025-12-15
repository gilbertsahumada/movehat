# Movehat Quick Start Guide

Get up and running with Movehat in 30 seconds.

## Prerequisites

- Node.js v18+
- Movement CLI installed ([Installation Guide](https://docs.movementnetwork.xyz/devs/movementcli))

Verify Movement CLI:
```bash
movement --version
```

## Installation

```bash
npm install -g movehat
```

## Create Your First Project

```bash
# 1. Create project
npx movehat init my-project
cd my-project

# 2. Install dependencies
npm install

# 3. Compile contracts (auto-detects addresses)
npx movehat compile

# 4. Run tests (uses simulation - no setup needed)
npm test
```

Done! Your tests are running with Transaction Simulation.

## What Just Happened?

1. **Created a Move project** with Counter contract example
2. **Compiled contracts** - Movehat auto-detected the `counter` named address
3. **Ran tests** using Transaction Simulation:
   - No real blockchain required
   - No gas costs
   - Auto-generated test accounts
   - Instant feedback

## Project Structure

```
my-project/
├── move/
│   ├── sources/
│   │   └── Counter.move       # Your Move smart contract
│   └── Move.toml
├── tests/
│   └── Counter.test.ts        # TypeScript tests (using simulation)
├── scripts/
│   └── deploy-counter.ts      # Deployment script
├── movehat.config.ts          # Network configuration
└── .env.example               # Environment template
```

## Testing Workflow

Your tests use **Transaction Simulation**:

```typescript
// Build transaction
const transaction = await mh.aptos.transaction.build.simple({
  sender: mh.account.accountAddress,
  data: {
    function: `${contractAddress}::counter::init`,
    functionArguments: []
  }
});

// Simulate (no gas, instant)
const [simulation] = await mh.aptos.transaction.simulate.simple({
  signerPublicKey: mh.account.publicKey,
  transaction
});

// Verify
expect(simulation.success).to.be.true;
```

Benefits:
- No blockchain setup
- No gas costs
- Instant results
- Perfect for TDD

## Ready to Deploy?

For real deployment to Movement testnet/mainnet:

1. **Set up your private key:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`:**
   ```bash
   PRIVATE_KEY=0x1234567890abcdef...
   ```

3. **Deploy:**
   ```bash
   npx movehat run scripts/deploy-counter.ts --network testnet
   ```

## Network Options

- `testnet` (default) - Movement testnet, auto-generates test accounts for simulation
- `mainnet` - Movement mainnet, requires `PRIVATE_KEY` in `.env`
- `local` - Local fork server on `localhost:8080`

## Common Commands

```bash
# Compile contracts
npx movehat compile

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Deploy to testnet
npx movehat run scripts/deploy-counter.ts

# Deploy to mainnet
npx movehat run scripts/deploy-counter.ts --network mainnet
```

## Next Steps

1. **Edit `move/sources/Counter.move`** - Modify your Move contract
2. **Edit `tests/Counter.test.ts`** - Add more test cases
3. **Run `npm test`** - See instant feedback with simulation
4. **Deploy when ready** - Use deployment scripts for real networks

## Need Help?

- [Full Documentation](./README.md)
- [Fork System Guide](./FORK_GUIDE.md)
- [GitHub Issues](https://github.com/gilbertsahumada/movehat/issues)
- [Movement Docs](https://docs.movementnetwork.xyz)

## Key Differences from Other Tools

| Feature | Movehat | Traditional |
|---------|---------|-------------|
| **Testing** | Transaction Simulation (instant) | Requires blockchain/fork |
| **Setup** | Zero config for testing | Need accounts, RPC, etc. |
| **Named Addresses** | Auto-detected from code | Manual configuration |
| **Account Config** | Single `PRIVATE_KEY` for all networks | Different per network |
| **Fork System** | Built-in, JSON-based | External tools |

---

**That's it!** You now have a fully functional Move development environment with instant testing feedback.

Happy coding! 🚀
