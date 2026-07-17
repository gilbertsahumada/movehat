# {{projectName}}

A Move smart contract project built with Movehat.

## Prerequisites

**Required:**
- **Node.js v20+** - [Download](https://nodejs.org/)
- **Movement CLI** - **REQUIRED** for compiling contracts

  Install: [Movement CLI Installation Guide](https://docs.movementnetwork.xyz/devs/movementCLI)

  Verify: `movement --version`

**IMPORTANT:** Without Movement CLI, compilation will fail!

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (public networks only)

The default workflow is local and needs no credentials. To deploy to a public
network, copy `.env.example` to `.env` and add your key:

```bash
cp .env.example .env
```

Edit `.env`:
```env
PRIVATE_KEY=<your private key>
```

### 3. Compile contracts

```bash
npm run compile
```

**How it works:**
- Movehat automatically detects named addresses from your Move files
- No need to manually configure addresses in `Move.toml`
- Just add any new `.move` file and it will compile automatically (like Hardhat!)

### 4. Run tests

```bash
npm test
```

When you run `npm test`, you'll see an **interactive menu**:

```text
? What tests do you want to run?
❯ Move unit tests (fast, no node required)
  TypeScript integration tests (starts local node)
  All tests (Move + TypeScript)
```

**Two types of tests available:**

1. **Move Unit Tests** (`move/sources/Counter.move` in `#[test]` blocks)
   - Written in Move with `#[test]` annotations
   - Test internal logic and business rules
   - Ultra-fast execution (milliseconds)
   - Run with: `npm run test:move` or `movehat test --move`

2. **TypeScript Integration Tests** (`tests/Counter.test.ts`)
   - Written in TypeScript on a **local Movement blockchain**
   - Automatically starts a local node, funds accounts, and deploys contracts
   - Runs real transactions (not simulation!)
   - Just like Hardhat - zero manual setup
   - Run with: `npm run test:ts` or `movehat test --ts`

**Commands:**
- `npm test` - Interactive menu to choose test type
- `npm run test:move` or `movehat test --move` - Only Move unit tests (fast)
- `npm run test:ts` or `movehat test --ts` - Only TypeScript integration tests
- `movehat test --all` - Both Move + TypeScript tests
- `npm run test:watch` or `movehat test --watch` - TypeScript tests in watch mode
- `npm run test:coverage` or `movehat test --coverage` - Move coverage summary

### 5. Deploy (optional)

```bash
# Safe default: local chain (movelite when available)
npx movehat run scripts/deploy-counter.ts

# Explicit public-network opt-in
npx movehat run scripts/deploy-counter.ts --network testnet
```

Network precedence is `--network`, `MOVEHAT_NETWORK`, `MH_DEFAULT_NETWORK`,
then `defaultNetwork` from `movehat.config.ts`.

## Project Structure

```text
{{projectName}}/
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
```

## Available Commands

- `npm run compile` - Compile Move contracts (auto-detects addresses)
- `npm run lint` - Lint Move contracts
- `npm run prove` - Run the Move Prover (runs until it finishes or you interrupt it)
- `npm test` - Run integration tests
- `npm run test:watch` - Run tests in watch mode
- `npx movehat run scripts/deploy-counter.ts` - Deploy locally and initialize counter

## How Named Addresses Work

Movehat automatically detects named addresses from your Move code:

```move
module counter::counter {  // ← "counter" is auto-detected
  // ...
}
```

- **For development:** Movehat uses temp addresses (`0xcafe`) automatically
- **For production:** Specify real addresses in `movehat.config.ts`

**Adding new contracts:**
1. Create `move/sources/MyContract.move`
2. Write: `module mycontract::mycontract { ... }`
3. Run `npm run compile`
4. It just works! (like Hardhat)

## Troubleshooting

| Error | Solution |
|-------|----------|
| `movement: command not found` | Install Movement CLI (see Prerequisites) |
| `Cannot find package 'dotenv'` | Run `npm install` |
| Compilation failed | Ensure Movement CLI is installed: `movement --version` |

## Learn More

- [Movement Documentation](https://docs.movementnetwork.xyz)
- [Move Language Book](https://move-language.github.io/move/)
- [Movehat GitHub](https://github.com/gilbertsahumada/movehat)
