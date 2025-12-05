# Contributing to Movehat

Thank you for your interest in contributing to Movehat!

## Development Setup

1. **Clone and install**
   ```bash
   git clone https://github.com/gilbertsahumada/movehat.git
   cd movehat
   pnpm install
   ```

2. **Link for global testing**
   ```bash
   cd packages/movehat
   npm link
   ```

## Development Workflow

### Making Changes

1. **Edit source code** in `packages/movehat/src/`
2. **Build** with `pnpm build:movehat` (or `pnpm dev` for watch mode)
3. **Test locally** using the example project

### Testing Locally

We use `examples/counter-example` as our test bed. It uses `"movehat": "workspace:*"` to always use your local version.

```bash
# Quick runtime test (from project root)
pnpm test:runtime

# Full example test
cd examples/counter-example
pnpm install
pnpm run deploy  # Test runtime initialization
pnpm test        # Run test suite (requires deployed contract)
```

### Testing Templates

The templates in `packages/movehat/src/templates/` are what users get when they run `movehat init`.

To test template changes:

1. Update files in `packages/movehat/src/templates/`
2. Build: `pnpm build:movehat`
3. Create test project: `movehat init /tmp/test-project`
4. Verify the generated files

**Important**: Templates use `"movehat": "workspace:*"` during development. This is automatically replaced with the actual version when publishing.

## Architecture

### Key Files

```
packages/movehat/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── runtime.ts          # Movehat Runtime Environment (MRE)
│   ├── commands/           # CLI commands (init, compile, deploy, test)
│   ├── helpers/            # Helper functions exported to users
│   ├── templates/          # Project templates (uses workspace:*)
│   └── types/              # TypeScript definitions
├── bin/
│   └── movehat.js          # Wrapper that runs CLI with tsx
└── dist/                   # Compiled output
```

### How the Framework Works

**Movehat Runtime Environment (MRE)**:
- Loads `movehat.config.ts` automatically
- Provides unified context (`mh.aptos`, `mh.account`, `mh.network`, etc.)
- Similar to Hardhat's HRE

**Template System**:
- Templates use `workspace:*` for local development
- GitHub Action replaces with actual version on publish
- No manual version management needed

## Publishing

### Development vs Production

- **Development**: `"movehat": "workspace:*"`
- **Production**: GitHub Action → `"movehat": "^0.0.1"`

### How to Publish

**Option 1: GitHub Release (Recommended)**

1. Create a new release with tag `vX.X.X`
2. Workflow automatically:
   - Replaces `workspace:*` with version
   - Builds package
   - Publishes to npm
   - Creates git tag

**Option 2: Manual Workflow Trigger**

1. Go to Actions > Publish to npm
2. Click "Run workflow"
3. Enter version number

### Before First Publish

Set up `NPM_TOKEN` secret:
1. Generate token at https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. Go to GitHub > Settings > Secrets and variables > Actions
3. Create secret `NPM_TOKEN` with your token

## Code Style

- Use TypeScript for all new code
- Follow existing code patterns
- Add JSDoc comments for exported functions
- Keep functions focused and single-purpose

## Testing

- Test changes in `examples/counter-example`
- Ensure `pnpm test:runtime` passes
- Verify `movehat init` creates valid projects
- Check that templates work as expected

## Pull Request Process

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally using the example project
5. Update documentation if needed
6. Submit PR with clear description

## Questions?

Open an issue or discussion on GitHub!
