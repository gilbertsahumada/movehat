# Movehat

Hardhat-like development framework for Movement L1 and Aptos Move smart contracts.

## Description

Movehat is a CLI tool that enables developers to build, compile, test, and deploy Move smart contracts for Movement L1, with a Hardhat-like developer experience. The goal is to provide a TypeScript-based development environment for writing tests and deployment scripts.

## Project Structure

```
movehat/
├── packages/
│   └── movehat/              # Main CLI package
│       ├── src/
│       │   ├── cli.ts        # CLI entry point
│       │   ├── commands/     # Commands (init, compile, deploy, test)
│       │   ├── helpers/      # Helper functions
│       │   ├── templates/    # Templates for new projects
│       │   └── types/        # TypeScript definitions
│       ├── dist/             # Compiled code
│       └── package.json
├── examples/
│   └── counter-example/      # Example project
└── package.json              # Workspace root
```

## Local Development

### Prerequisites

- Node.js >= 18
- pnpm >= 9.0.0

### Initial Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/gilbertsahumada/movehat.git
   cd movehat
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Build the package**
   ```bash
   pnpm build:movehat
   ```

### Testing the CLI Locally (without publishing to npm)

To test the CLI globally without publishing it to npm:

1. **Link the package globally**
   ```bash
   cd packages/movehat
   npm link
   ```

   This creates a symlink on your system pointing to your local code. Any changes you compile will be immediately available.

2. **Verify the command is available**
   ```bash
   which movehat
   # Should show: ~/.nvm/versions/node/vX.X.X/bin/movehat

   movehat --version
   # Should show: 1.0.0
   ```

3. **Test the init command**
   ```bash
   # In any directory
   cd /tmp
   mkdir test-project
   cd test-project

   # Initialize a new project
   movehat init my-move-project
   ```

### Development Workflow

1. **Make changes to the source code**
   ```bash
   # Edit files in packages/movehat/src/
   vim packages/movehat/src/commands/init.ts
   ```

2. **Rebuild**
   ```bash
   # From the project root
   pnpm build:movehat

   # Or in watch mode (auto-recompiles)
   pnpm dev
   ```

3. **Test changes immediately**
   ```bash
   # The movehat command uses the latest compiled code
   movehat init test-project
   ```

### Unlink when finished

When you're done developing and want to remove the global command:

```bash
cd packages/movehat
npm unlink -g movehat
```

## Available Commands

### Workspace (from root)

- `pnpm build` - Builds all packages
- `pnpm build:movehat` - Builds only the movehat package
- `pnpm dev` - Watch mode for development
- `pnpm clean` - Cleans compiled files
- `pnpm test:example` - Runs example project tests

### Movehat CLI

Once installed or linked:

- `movehat init [project-name]` - Initialize a new Move project
- `movehat compile` - Compile Move contracts
- `movehat test` - Run TypeScript tests
- `movehat deploy` - Deploy contracts to the network

## Movehat Project Structure

When you run `movehat init my-project`, the following structure is generated:

```
my-project/
├── move/                     # Move code
│   ├── Move.toml            # Move project configuration
│   └── sources/
│       └── Counter.move     # Example contract
├── scripts/                 # Deployment scripts
│   └── deploy-counter.ts
├── tests/                   # TypeScript tests
│   └── Counter.test.ts
├── movehat.config.ts        # Movehat configuration
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Testing

To test the example project:

```bash
cd examples/counter-example
pnpm install
pnpm test
```

## Publishing (Future)

When you're ready to publish to npm:

1. **Update version**
   ```bash
   cd packages/movehat
   # Edit package.json and update the version
   ```

2. **Build**
   ```bash
   pnpm build:movehat
   ```

3. **Publish**
   ```bash
   npm publish
   ```

## Troubleshooting

### `movehat` command not found

If after `npm link` you can't find the command:

```bash
# Verify the link was created
ls -la $(npm root -g)/movehat

# Check your PATH
echo $PATH

# Re-link
cd packages/movehat
npm unlink -g movehat
npm link
```

### Changes are not reflected

Make sure to rebuild after making changes:

```bash
pnpm build:movehat
```

### Error "templates not found"

If you see errors about missing templates, ensure the `copy-templates` script ran:

```bash
cd packages/movehat
npm run copy-templates
```

## Contributing

1. Fork the project
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

## Author

Gilberts Ahumada
