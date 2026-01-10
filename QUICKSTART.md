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

Movehat provides **two types of tests** for comprehensive coverage:

### Move Unit Tests (Fast)

Tests written directly in your Move files:

```move
#[test(account = @0x1)]
public fun test_increment(account: &signer) acquires Counter {
    let addr = signer::address_of(account);
    aptos_framework::account::create_account_for_test(addr);

    init(account);
    assert!(get(addr) == 0, 0);

    increment(account);
    assert!(get(addr) == 1, 1);
}
```

Run with: `movehat test --move` (ultra-fast, milliseconds)

### TypeScript Integration Tests (Local Node)

Tests written in TypeScript that run on a **local Movement blockchain**:

```typescript
import { setupTestFixture, teardownTestFixture } from "movehat/helpers";

describe("Counter Contract", () => {
  let fixture;

  before(async function () {
    this.timeout(60000);
    // Starts local node, funds accounts, deploys contracts
    fixture = await setupTestFixture(['counter'] as const, ['alice', 'bob']);
  });

  it("should increment counter", async () => {
    const counter = fixture.contracts.counter;
    const deployer = fixture.accounts.deployer;

    // Real transaction on local blockchain
    await counter.call(deployer, "increment", []);

    const value = await counter.view<string>("get", [
      deployer.accountAddress.toString()
    ]);

    expect(parseInt(value)).to.equal(1);
  });

  after(async () => {
    await teardownTestFixture();
  });
});
```

Run with: `movehat test --ts` (starts local node)

### Interactive Test Menu

When you run `npm test` (or `movehat test`), you'll see an interactive menu:

```
? What tests do you want to run?
❯ Move unit tests (fast, no node required)
  TypeScript integration tests (starts local node)
  All tests (Move + TypeScript)
```

**Benefits:**
- **Move tests**: Ultra-fast (ms), test internal logic
- **TypeScript tests**: Real transactions on local blockchain
- **Interactive menu**: Choose what you need, or use flags for CI/CD

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

# Run tests (interactive menu)
npm test

# Run only Move tests (ultra-fast, no node required)
movehat test --move

# Run only TypeScript tests (starts local node)
movehat test --ts

# Run all tests (Move + TypeScript)
movehat test --all

# Run TypeScript tests in watch mode
movehat test --watch

# Filter Move tests
movehat test --move --filter test_increment

# Deploy to testnet
npx movehat run scripts/deploy-counter.ts

# Deploy to mainnet
npx movehat run scripts/deploy-counter.ts --network mainnet
```

## Next Steps

1. **Edit `move/sources/Counter.move`** - Modify your Move contract and add `#[test]` functions
2. **Run `npm run test:move`** - Ultra-fast feedback on Move logic (TDD workflow)
3. **Edit `tests/Counter.test.ts`** - Add TypeScript integration tests
4. **Run `npm test`** - Full test suite (Move + TypeScript)
5. **Deploy when ready** - Use deployment scripts for real networks

## Testing Best Practices

**During development (TDD):**
```bash
# Write Move function
vim move/sources/Counter.move

# Add Move test
# Run Move tests (instant feedback)
movehat test --move

# Iterate until logic is correct
```

**Before committing:**
```bash
# Run full test suite
movehat test --all

# Both Move and TypeScript tests must pass
```

**In CI/CD:**
```bash
# Fast tests only (no node required)
movehat test --move

# Or full tests if you need TypeScript integration tests
movehat test --all
```

## Need Help?

- [Full Documentation](./README.md)
- [Fork System Guide](./FORK_GUIDE.md)
- [GitHub Issues](https://github.com/gilbertsahumada/movehat/issues)
- [Movement Docs](https://docs.movementnetwork.xyz)

## Key Differences from Other Tools

| Feature | Movehat | Hardhat | Foundry |
|---------|---------|---------|---------|
| **Move Unit Tests** | Yes - `test:move` (ms) | N/A | Yes - `forge test` |
| **Integration Tests** | Yes - `test:ts` (simulation) | Yes - `test` | Yes - `test --fork` |
| **Dual Testing** | Yes - Both in one command | No - Only integration | Yes - Both |
| **Setup for Testing** | Zero config | Need local node | Zero config |
| **Named Addresses** | Auto-detected | N/A | Manual |
| **Account Config** | Single `PRIVATE_KEY` | Single account | Multiple |
| **Fork System** | Built-in JSON | External | Built-in |
| **Language** | Move + TypeScript | Solidity + JS/TS | Solidity |

**Movehat = Hardhat UX + Foundry Testing** for Move development

---

That's it! You now have a fully functional Move development environment with instant testing feedback.

Happy coding!
