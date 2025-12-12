# MoveHat Fork System

MoveHat includes a native fork system that creates local snapshots of Movement L1 network state. Unlike traditional forks, MoveHat's fork system:

Uses JSON API (no BCS compatibility issues)
Works natively with Movement L1
Implements lazy loading (only fetches accessed resources)
Provides clean CLI and programmatic API
Stores state as human-readable JSON

## Quick Start

### 1. Create a Fork

```bash
movehat fork create --network testnet --name my-fork
```

This creates a fork snapshot at the current ledger version.

### 2. View Resources

```bash
movehat fork view-resource \
  --fork .movehat/forks/my-fork \
  --account 0x1 \
  --resource "0x1::coin::CoinInfo<0x1::aptos_coin::AptosCoin>"
```

First access fetches from network and caches locally. Subsequent accesses use the cache.

### 3. Fund Accounts

```bash
movehat fork fund \
  --fork .movehat/forks/my-fork \
  --account 0x123 \
  --amount 5000000000
```

Modifies the local fork state - perfect for testing!

### 4. List Forks

```bash
movehat fork list
```

Shows all available forks with their metadata.

### 5. Serve Fork via RPC

```bash
movehat fork serve --fork .movehat/forks/my-fork --port 8080
```

Start a local RPC server that serves the fork. Connect your Aptos/Movement SDK to `http://localhost:8080/v1` to interact with the fork.

## CLI Commands

### `movehat fork create`

Create a new fork from a network.

**Options:**
- `--network <name>` - Network to fork (default: from config)
- `--name <name>` - Name for the fork (default: `<network>-fork`)
- `--path <path>` - Custom path for the fork

**Example:**
```bash
movehat fork create --network testnet --name test-snapshot
```

### `movehat fork view-resource`

View a resource from the fork.

**Options:**
- `--fork <path>` - Path to the fork (default: `.movehat/forks/<network>-fork`)
- `--account <address>` - Account address (required)
- `--resource <type>` - Resource type (required)

**Example:**
```bash
movehat fork view-resource \
  --account 0x1 \
  --resource "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>"
```

### `movehat fork fund`

Fund an account in the fork.

**Options:**
- `--fork <path>` - Path to the fork
- `--account <address>` - Account address (required)
- `--amount <amount>` - Amount to fund (required)
- `--coin-type <type>` - Coin type (default: `0x1::aptos_coin::AptosCoin`)

**Example:**
```bash
movehat fork fund --account 0xABC --amount 1000000000
```

### `movehat fork list`

List all available forks with metadata.

### `movehat fork serve`

Start a local RPC server that serves fork data via the Movement/Aptos API.

**Options:**
- `--fork <path>` - Path to the fork (default: `.movehat/forks/<network>-fork`)
- `--port <port>` - Port to listen on (default: 8080)

**Example:**
```bash
movehat fork serve --fork .movehat/forks/my-fork --port 8080
```

This starts an HTTP server that emulates a Movement L1 node using your fork's data. You can then connect the Aptos/Movement SDK to `http://localhost:8080/v1` to interact with the fork state.

**Supported Endpoints:**
- `GET /v1/` - Ledger info (chain ID, version, block height)
- `GET /v1/accounts/:address` - Account data
- `GET /v1/accounts/:address/resource/:type` - Specific resource
- `GET /v1/accounts/:address/resources` - All resources for an account

**Error Handling:**

The fork server returns JSON error responses with appropriate HTTP status codes and specific error codes:

- **404 Errors**:
  ```json
  {
    "message": "Endpoint not found: /v1/invalid",
    "error_code": "endpoint_not_found",
    "vm_error_code": null
  }
  ```

  ```json
  {
    "message": "Account not found: 0x123...",
    "error_code": "account_not_found",
    "vm_error_code": null
  }
  ```

  ```json
  {
    "message": "Resource not found: 0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>",
    "error_code": "resource_not_found",
    "vm_error_code": null
  }
  ```

- **500 Errors**:
  ```json
  {
    "message": "Internal server error",
    "error_code": "internal_error",
    "vm_error_code": null
  }
  ```

All responses include CORS headers for cross-origin requests.

**Usage with Aptos SDK:**
```typescript
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const config = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: "http://localhost:8080/v1",
});
const aptos = new Aptos(config);

// Query the fork
const ledgerInfo = await aptos.getLedgerInfo();
const account = await aptos.getAccountInfo({ accountAddress: "0x1" });
```

## Programmatic API

You can use forks programmatically in your tests and scripts.

### Basic Usage

```typescript
import { ForkManager } from 'movehat';

// Create and initialize a fork
const fork = new ForkManager('.movehat/forks/test');
await fork.initialize('https://testnet.movementnetwork.xyz/v1', 'testnet');

// Get metadata
const metadata = fork.getMetadata();
console.log(`Fork at version: ${metadata.ledgerVersion}`);

// Get a resource (with lazy loading)
const coinInfo = await fork.getResource(
  '0x1',
  '0x1::coin::CoinInfo<0x1::aptos_coin::AptosCoin>'
);
console.log(`Token name: ${coinInfo.name}`);
console.log(`Decimals: ${coinInfo.decimals}`);
```

### Testing Example

```typescript
import { describe, it, before } from 'mocha';
import { expect } from 'chai';
import { ForkManager } from 'movehat';

describe('My Contract Tests', () => {
  let fork: ForkManager;

  before(async () => {
    // Initialize fork
    fork = new ForkManager('.movehat/forks/test');
    await fork.initialize('https://testnet.movementnetwork.xyz/v1', 'testnet');
  });

  it('should read token info from fork', async () => {
    const coinInfo = await fork.getResource(
      '0x1',
      '0x1::coin::CoinInfo<0x1::aptos_coin::AptosCoin>'
    );

    expect(coinInfo.name).to.equal('Move Coin');
    expect(coinInfo.symbol).to.equal('MOVE');
    expect(coinInfo.decimals).to.equal(8);
  });

  it('should fund and verify account balance', async () => {
    // Fund an account
    await fork.fundAccount('0x123', 5_000_000_000);

    // Verify the balance
    const coinStore = await fork.getResource(
      '0x123',
      '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );

    expect(coinStore.coin.value).to.equal('5000000000');
  });

  it('should modify fork state without affecting network', async () => {
    const testAccount = '0xABC';

    // Fund account
    await fork.fundAccount(testAccount, 1_000_000);

    // Modify balance
    const coinStore = await fork.getResource(
      testAccount,
      '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );
    coinStore.coin.value = '2000000'; // Double the balance

    await fork.setResource(
      testAccount,
      '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>',
      coinStore
    );

    // Verify modification
    const updated = await fork.getResource(
      testAccount,
      '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );
    expect(updated.coin.value).to.equal('2000000');
  });
});
```

### Advanced: Loading Existing Fork

```typescript
import { ForkManager } from 'movehat';

// Load an existing fork
const fork = new ForkManager('.movehat/forks/my-fork');
fork.load(); // Loads metadata from disk

// Get metadata
const metadata = fork.getMetadata();
console.log(`Forked from: ${metadata.network}`);
console.log(`Chain ID: ${metadata.chainId}`);

// Access cached resources
const resource = await fork.getResource(address, resourceType);
```

## Fork Storage Structure

Forks are stored as JSON files for easy inspection and version control:

```
.movehat/forks/
  my-fork/
    metadata.json           # Network info, ledger version
    accounts.json           # Account states (sequence numbers, auth keys)
    resources/              # Resource data by account
      0x1.json              # All resources for account 0x1
      0xABC123.json         # All resources for account 0xABC123
    cache/
      .gitignore            # Cache ignored in git
```

### Example Files

**metadata.json:**
```json
{
  "network": "testnet",
  "nodeUrl": "https://testnet.movementnetwork.xyz/v1",
  "chainId": 250,
  "ledgerVersion": "49825529",
  "timestamp": "1765402199957937",
  "epoch": "2112090",
  "blockHeight": "15097075",
  "createdAt": "2025-12-10T21:48:22.123Z"
}
```

**accounts.json:**
```json
{
  "0x0000000000000000000000000000000000000000000000000000000000000001": {
    "sequenceNumber": "0",
    "authenticationKey": "0x0000000000000000000000000000000000000000000000000000000000000001"
  }
}
```

**resources/0x1.json:**
```json
{
  "0x1::coin::CoinInfo<0x1::aptos_coin::AptosCoin>": {
    "decimals": 8,
    "name": "Move Coin",
    "symbol": "MOVE",
    "supply": { ... }
  }
}
```

## API Reference

### ForkManager

Main class for managing forks.

#### Constructor

```typescript
new ForkManager(forkPath: string)
```

Creates a new fork manager instance.

#### Methods

##### `async initialize(nodeUrl: string, networkName?: string): Promise<void>`

Initialize a new fork from a network.

- `nodeUrl` - Network RPC URL
- `networkName` - Optional network name (default: 'custom')

##### `load(): void`

Load an existing fork from disk.

##### `getMetadata(): ForkMetadata`

Get fork metadata (network info, versions, etc.).

##### `async getResource(address: string, resourceType: string): Promise<any>`

Get a resource with lazy loading. Fetches from network if not cached.

- `address` - Account address
- `resourceType` - Full resource type string

##### `async getAllResources(address: string): Promise<Record<string, any>>`

Get all resources for an account.

##### `async setResource(address: string, resourceType: string, data: any): Promise<void>`

Set/update a resource value (for testing).

##### `async fundAccount(address: string, amount: number, coinType?: string): Promise<void>`

Fund an account with coins.

- `address` - Account address
- `amount` - Amount to fund
- `coinType` - Coin type (default: `0x1::aptos_coin::AptosCoin`)

##### `listAccounts(): string[]`

List all accounts in the fork.

## How It Works

### Lazy Loading

MoveHat forks use lazy loading to minimize network requests and storage:

1. **Fork Creation**: Only fetches network metadata (chain ID, ledger version, etc.)
2. **Resource Access**: Fetches resources on-demand when first accessed
3. **Caching**: Stores fetched resources locally for subsequent access
4. **Modification**: Modified resources are saved immediately

This approach is efficient for testing where you only need a subset of blockchain state.

### JSON vs BCS

MoveHat uses JSON API instead of BCS (Binary Canonical Serialization):

**Why JSON?**
- Movement L1's BCS format differs from Aptos
- JSON is human-readable
- Easy to inspect and debug
- No binary parsing errors
- Works consistently across networks

### Comparison with Aptos CLI

| Feature | MoveHat Forks | Aptos CLI Sim |
|---------|---------------|---------------|
| Works with Movement | Yes | BCS incompatible |
| JSON-based | Yes | BCS only |
| Lazy loading | Yes | Downloads all |
| Human-readable storage | Yes | Binary |
| Programmatic API | Clean API | Limited |
| Test-friendly | Very | Complex |

## Best Practices

### 1. One Fork Per Test Suite

```typescript
describe('Token Tests', () => {
  let fork: ForkManager;

  before(async () => {
    fork = new ForkManager('.movehat/forks/token-tests');
    await fork.initialize(networkUrl, 'testnet');
  });

  // All tests share the same fork
});
```

### 2. Clean Forks for Each Run

Add to your test setup:
```bash
rm -rf .movehat/forks/test-* # Clean test forks
```

### 3. Version Control

Add to `.gitignore`:
```
.movehat/forks/*/cache/
```

But **commit** metadata and resources for reproducible tests.

### 4. Network Selection

Use different forks for different networks:
```bash
movehat fork create --network testnet --name testnet-fork
movehat fork create --network mainnet --name mainnet-fork
```

## Troubleshooting

### Fork creation fails with "API request failed"

- Check network URL in config
- Verify network is accessible
- Try: `curl https://testnet.movementnetwork.xyz/v1/`

### Resource not found (404)

- Verify account address exists on network
- Check resource type string (must be exact)
- Account might not have that resource initialized

### Fork path issues

- Always use absolute paths when outside project directory
- Default fork path: `.movehat/forks/<name>`
- Check with `movehat fork list`

### Fork server port already in use

If you see `Port 8080 is already in use`:
- Use a different port: `movehat fork serve --port 8081`
- Or stop the process using the port: `lsof -ti:8080 | xargs kill`

### Fork server permission denied

If you see `Permission denied to bind to port`:
- Use a port above 1024 (ports below 1024 require root privileges)
- Try: `movehat fork serve --port 8080` (or any port above 1024)

## Examples

See `examples/counter-example/` for a complete example project using forks.

## Contributing

Fork system improvements welcome! See:
- `packages/movehat/src/fork/manager.ts` - Main logic
- `packages/movehat/src/fork/api.ts` - API client
- `packages/movehat/src/fork/storage.ts` - Storage layer
- `packages/movehat/src/fork/server.ts` - RPC server
