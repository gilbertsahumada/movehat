# {{projectName}}

A Move smart contract project built with Movehat.

## Prerequisites

**Required:**
- **Node.js v18+** - [Download](https://nodejs.org/)
- **Movement CLI** - **REQUIRED** for compiling contracts

  Install: [Movement CLI Installation Guide](https://docs.movementnetwork.xyz/devs/movementCLI)

  Verify: `movement --version`

**⚠️ Important:** Without Movement CLI, compilation will fail!

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:
```
PRIVATE_KEY=your_private_key_here
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

**Two types of tests available:**

1. **Move Unit Tests** (`tests/Counter.move` lines 50-63)
   - Written in Move with `#[test]` annotations
   - Test internal logic and business rules
   - Ultra-fast execution (milliseconds)
   - Run with: `npm run test:move`

2. **TypeScript Integration Tests** (`tests/Counter.test.ts`)
   - Written in TypeScript using Transaction Simulation
   - Test end-to-end flows and SDK integration
   - No blockchain or gas costs required
   - Run with: `npm run test:ts`

**Commands:**
- `npm test` - Runs both Move + TypeScript tests
- `npm run test:move` - Only Move unit tests (fast)
- `npm run test:ts` - Only TypeScript integration tests
- `npm run test:watch` - TypeScript tests in watch mode

### 5. Deploy (optional)

```bash
npx movehat run scripts/deploy-counter.ts
```

## Project Structure

```
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
```

## Available Commands

- `npm run compile` - Compile Move contracts (auto-detects addresses)
- `npm test` - Run integration tests
- `npm run test:watch` - Run tests in watch mode
- `npx movehat run scripts/deploy-counter.ts` - Deploy and initialize counter

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
- [Aptos Move Book](https://move-language.github.io/move/)
- [Movehat GitHub](https://github.com/gilbertsahumada/movehat)