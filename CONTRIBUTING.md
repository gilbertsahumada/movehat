# Contributing to Movehat

Thank you for your interest in contributing to Movehat! This guide will help you set up your development environment and understand the project structure.

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 9.0.0
- **Movement CLI** installed and configured

## Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/gilbertsahumada/movehat.git
cd movehat
pnpm install
```

### 2. Build the Package

```bash
pnpm build:movehat
```

This compiles TypeScript and copies templates to `dist/`.

### 3. Link for Global Testing

To test the CLI globally without publishing to npm:

```bash
cd packages/movehat
npm link
```

This creates a symlink, so any changes you compile will be immediately available.

### 4. Verify Installation

```bash
which movehat
# Should show: ~/.nvm/versions/node/vX.X.X/bin/movehat

movehat --version
# Should show: 0.0.1 (or the actual version)
```

## Development Workflow

### Making Changes

1. **Edit source code** in `packages/movehat/src/`
2. **Rebuild** with `pnpm build:movehat`
   - Or use `pnpm dev` for watch mode (auto-recompiles on file changes)
3. **Test locally** using the example project

```bash
# From project root
pnpm build:movehat

# Or watch mode for development
pnpm dev
```

### Testing Your Changes

#### Option 1: Use the Example Project

The `examples/counter-example` project serves as the test bed. It uses `"movehat": "workspace:*"` to always reference your local version.

```bash
cd examples/counter-example

# Test compile command
movehat compile

# Test run command
movehat run scripts/deploy-counter.ts

# Test with network flag
movehat run scripts/deploy-counter.ts --network testnet

# Run TypeScript tests
pnpm test
```

#### Option 2: Create a Test Project

```bash
# In any directory
cd /tmp
mkdir test-project
cd test-project

# Initialize with your local movehat
movehat init

# Install dependencies
pnpm install

# Test the workflow
movehat compile
movehat run scripts/deploy-counter.ts
```

### Testing Templates

The templates in `packages/movehat/src/templates/` are what users get when they run `movehat init`.

**To test template changes:**

1. Update files in `packages/movehat/src/templates/`
2. Build: `pnpm build:movehat` (this copies templates to dist/)
3. Create test project: `movehat init /tmp/test-project`
4. Verify the generated files

**Important:** Templates use `"movehat": "workspace:*"` during development. This is automatically replaced with the actual version when publishing via GitHub Actions.

## Project Architecture

### Workspace Structure

```
movehat/
├── packages/
│   └── movehat/              # Main CLI package
│       ├── src/
│       │   ├── cli.ts        # CLI entry point (commander.js)
│       │   ├── runtime.ts    # Movehat Runtime Environment (MRE)
│       │   ├── commands/     # CLI commands
│       │   │   ├── init.ts
│       │   │   ├── compile.ts
│       │   │   ├── run.ts
│       │   │   └── test.ts
│       │   ├── helpers/      # Helper functions
│       │   │   ├── config.ts
│       │   │   ├── setup.ts
│       │   │   └── index.ts  # Exported helpers
│       │   ├── templates/    # Project templates
│       │   │   ├── movehat.config.ts
│       │   │   ├── package.json
│       │   │   ├── scripts/
│       │   │   ├── tests/
│       │   │   ├── move/
│       │   │   ├── types/    # Dev-only, not copied
│       │   │   └── .vscode/  # Dev-only, not copied
│       │   └── types/        # TypeScript type definitions
│       ├── bin/
│       │   └── movehat.js    # Wrapper that runs CLI with tsx
│       └── dist/             # Compiled output
├── examples/
│   └── counter-example/      # Test bed project
└── package.json              # Workspace root
```

### Key Concepts

#### Movehat Runtime Environment (MRE)

The MRE is the core of Movehat, similar to Hardhat's HRE. It provides a unified context object that:

- Loads `movehat.config.ts` automatically
- Resolves network configuration
- Initializes Aptos SDK client
- Manages accounts
- Provides helper functions

**Location:** `packages/movehat/src/runtime.ts`

**Exported via:** `getMovehat()` helper

**Properties:**
```typescript
{
  config: MovehatConfig;      // Resolved configuration
  network: NetworkInfo;       // Network details
  aptos: Aptos;              // Aptos SDK client
  account: Account;          // Primary account
  accounts: Account[];       // All accounts
  getContract: Function;     // Contract helper
  switchNetwork: Function;   // Network switcher
}
```

#### Configuration System

**User Config** (`MovehatUserConfig`):
- Defined in user's `movehat.config.ts`
- Multi-network support
- Named addresses
- Global settings

**Resolved Config** (`MovehatConfig`):
- Generated by `resolveNetworkConfig()`
- Merges global + network-specific settings
- Handles environment variables
- Single network context

**Location:** `packages/movehat/src/helpers/config.ts`

#### Template System

Templates are copied when users run `movehat init`. During development:

- Templates use `"movehat": "workspace:*"` for testing
- Development-only files (`.vscode/`, `types/`) are excluded from copy
- GitHub Action replaces `workspace:*` with actual version on publish

**Location:** `packages/movehat/src/templates/`

**Copy logic:** `packages/movehat/src/commands/init.ts`

#### Deployment Tracking System

Movehat automatically tracks deployments per network, similar to hardhat-deploy. This prevents accidental redeployments and maintains a deployment history.

**How it works:**

1. When `deployContract(moduleName)` is called:
   - Checks if module is already deployed on current network
   - If already deployed AND `--redeploy` flag not set:
     - Shows error message with deployment details
     - Suggests using `--redeploy` flag
     - Exits with `process.exit(1)`
   - If not deployed OR `--redeploy` flag is set:
     - Deploys the module
     - Saves deployment info to `deployments/<network>/<module>.json`

2. The `--redeploy` flag flow:
   - User passes flag: `movehat run script.ts --network testnet --redeploy`
   - CLI `preAction` hook stores in env: `process.env.MH_CLI_REDEPLOY = 'true'`
   - `deployContract()` reads env var and skips deployment check

**Deployment file structure:**
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

**Deployment JSON format:**
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

**Key functions:**
- `deployContract(moduleName, options?)` - Deploy module with automatic check
- `getDeployment(moduleName)` - Get deployment info for a module
- `getDeployments()` - Get all deployments for current network
- `getDeploymentAddress(moduleName)` - Get deployed address for a module

**Location:**
- `packages/movehat/src/runtime.ts` - `deployContract()` function
- `packages/movehat/src/helpers/deployments.ts` - Deployment tracking helpers

#### CLI Execution Flow

1. User runs `movehat <command>`
2. `bin/movehat.js` spawns `tsx` with `cli.ts`
3. `cli.ts` (commander.js) parses arguments
4. `preAction` hook stores `--network` and `--redeploy` flags in env vars
5. Command function executes
6. For `run` command: spawns `tsx` with user's script
7. User script calls `getMovehat()` to get MRE
8. If user calls `deployContract()`:
   - Checks deployment history for current network
   - Either deploys or shows error with `--redeploy` suggestion

## Available Commands

### Workspace Commands (from root)

```bash
pnpm build              # Build all packages
pnpm build:movehat      # Build only movehat
pnpm dev                # Watch mode for development
pnpm clean              # Clean compiled files
pnpm test:runtime       # Quick runtime test
pnpm test:example       # Run example project tests
```

### Movehat CLI Commands

```bash
movehat init [name]                    # Initialize new project
movehat compile                        # Compile Move contracts
movehat run <script> [--network <name>] # Run TypeScript script
movehat test                           # Run TypeScript tests
```

## Code Guidelines

### TypeScript

- Use TypeScript for all new code
- Add proper type definitions
- Export types from `src/types/`
- Use JSDoc comments for exported functions

### Code Style

- Follow existing code patterns
- Keep functions focused and single-purpose
- Use descriptive variable names
- Add error handling with clear messages

### Error Messages

Provide helpful error messages with actionable solutions:

```typescript
// Good
throw new Error(
  `Network '${network}' not found in configuration.\n` +
  `Available networks: ${availableNetworks}\n` +
  `Add the network to your movehat.config.ts`
);

// Bad
throw new Error("Network not found");
```

### Logging

Use consistent logging format:

```typescript
console.log("✅ Success message");
console.log("📦 Action being performed...");
console.log("   Detail info");
console.error("❌ Error message");
```

## Testing Checklist

Before submitting a PR, ensure:

- [ ] `pnpm build:movehat` succeeds without errors
- [ ] `movehat init` creates valid project structure
- [ ] `movehat compile` works in example project
- [ ] `movehat run` executes scripts correctly
- [ ] `--network` flag works properly
- [ ] `--redeploy` flag works properly
- [ ] Deployment tracking works (first deploy, already deployed error, force redeploy)
- [ ] Deployment files are created correctly in `deployments/<network>/`
- [ ] Templates are copied correctly (no dev files)
- [ ] TypeScript types are correct
- [ ] Error messages are clear and helpful
- [ ] Documentation is updated if needed

## Common Development Tasks

### Add a New CLI Command

1. Create command file in `src/commands/`:

```typescript
// src/commands/mycommand.ts
export default async function myCommand() {
  console.log("My command!");
}
```

2. Import and register in `src/cli.ts`:

```typescript
import myCommand from './commands/mycommand.js';

program
  .command('mycommand')
  .description('Description of my command')
  .action(myCommand);
```

3. Rebuild and test:

```bash
pnpm build:movehat
movehat mycommand
```

### Add a Helper Function

1. Add function to `src/helpers/`:

```typescript
// src/helpers/myhelper.ts
export function myHelper() {
  // Implementation
}
```

2. Export from `src/helpers/index.ts`:

```typescript
export { myHelper } from './myhelper.js';
```

3. Update types in `src/types/` if needed

4. Users can now import:

```typescript
import { myHelper } from "movehat/helpers";
```

### Update Templates

1. Edit files in `src/templates/`
2. Rebuild: `pnpm build:movehat`
3. Test: `movehat init /tmp/test-project`
4. Verify generated files

**Note:** Files in `templates/types/` and `templates/.vscode/` are excluded from copy.

### Debug TypeScript Config Loading

The config loader uses tsx's register API to handle `.ts` files:

```typescript
// src/helpers/config.ts
if (configPath.endsWith('.ts')) {
  const { register } = await import('tsx/esm/api');
  const unregister = register();
  try {
    configModule = await import(configUrl);
  } finally {
    unregister();
  }
}
```

### Test Multi-Network Functionality

```bash
cd examples/counter-example

# Test network selection
movehat run scripts/deploy-counter.ts --network testnet
movehat run scripts/deploy-counter.ts --network mainnet
movehat run scripts/deploy-counter.ts --network local

# Test env var override
MH_CLI_NETWORK=testnet movehat run scripts/deploy-counter.ts
```

### Test Deployment Tracking System

The deployment tracking system is critical to test thoroughly:

```bash
cd examples/counter-example

# Scenario 1: First deployment
movehat run scripts/deploy-counter.ts --network testnet
# Expected: ✅ Deploys successfully
# Expected: Creates deployments/testnet/counter.json

# Scenario 2: Already deployed (should fail)
movehat run scripts/deploy-counter.ts --network testnet
# Expected: ❌ Error message showing:
#   - Module "counter" is already deployed on testnet
#   - Deployment address
#   - Deployment timestamp
#   - Transaction hash
#   - Suggestion to use --redeploy flag
# Expected: Exits with code 1

# Scenario 3: Force redeploy
movehat run scripts/deploy-counter.ts --network testnet --redeploy
# Expected: 🔄 Shows "Redeploying module..." message
# Expected: ✅ Deploys successfully
# Expected: Updates deployments/testnet/counter.json

# Scenario 4: Different network (should work)
movehat run scripts/deploy-counter.ts --network local
# Expected: ✅ Deploys successfully (different network)
# Expected: Creates deployments/local/counter.json

# Verify deployment files
cat deployments/testnet/counter.json
# Expected: Valid JSON with address, moduleName, network, deployer, timestamp, txHash
```

**Testing deployment helper functions:**

Create a test script to verify the deployment query functions work correctly:

```typescript
// test-deployments.ts
import { getMovehat } from "movehat";

async function main() {
  const mh = await getMovehat();

  // Test getDeployment
  const deployment = mh.getDeployment("counter");
  console.log("Single deployment:", deployment);

  // Test getDeployments
  const allDeployments = mh.getDeployments();
  console.log("All deployments:", allDeployments);

  // Test getDeploymentAddress
  const address = mh.getDeploymentAddress("counter");
  console.log("Counter address:", address);
}

main().catch(console.error);
```

Run with:
```bash
movehat run test-deployments.ts --network testnet
```

## Publishing

### Development vs Production

- **Development**: `"movehat": "workspace:*"` in templates
- **Production**: GitHub Action replaces with `"movehat": "^X.X.X"`

## Troubleshooting Development

### `movehat` command not found after linking

```bash
# Verify the link
ls -la $(npm root -g)/movehat

# Re-link
cd packages/movehat
npm unlink -g movehat
npm link
```

### Changes not reflected

Make sure to rebuild:

```bash
pnpm build:movehat
```

### Templates not copied

The build script should copy templates. If not:

```bash
cd packages/movehat
npm run copy-templates
```

### TypeScript errors in templates during development

Templates have their own type declarations in `templates/types/movehat.d.ts` for development. These are not copied to user projects.

### Import errors

Remember to use `.js` extensions in imports (TypeScript ESM requirement):

```typescript
// Correct
import { loadUserConfig } from './helpers/config.js';

// Wrong
import { loadUserConfig } from './helpers/config';
```

## Unlink When Finished

When you're done developing:

```bash
cd packages/movehat
npm unlink -g movehat
```

## Pull Request Process

1. **Fork the repository**
2. **Create a feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Make your changes**
4. **Test thoroughly** (see Testing Checklist)
5. **Update documentation** if needed
6. **Commit with clear messages**
   ```bash
   git commit -m "Add: new feature description"
   ```
7. **Push to your fork**
   ```bash
   git push origin feature/my-feature
   ```
8. **Submit PR** with:
   - Clear description of changes
   - Why the change is needed
   - How you tested it
   - Any breaking changes

## Code Review Process

- All PRs require review before merging
- Address review comments
- Keep PRs focused and reasonably sized
- Update your branch if main has moved forward

## Questions or Issues?

- **Bug reports**: Open an issue on GitHub with reproduction steps
- **Feature requests**: Open an issue describing the use case
- **Questions**: Open a discussion on GitHub
- **Security issues**: Email directly (see security policy)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Your contributions make Movehat better for everyone. Thank you for taking the time to contribute!
