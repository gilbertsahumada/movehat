/**
 * Configuration for a single network
 */
export interface NetworkConfig {
    url: string;
    accounts?: string[]; // Optional: if not provided, uses global accounts
    chainId?: string;
    profile?: string;
    namedAddresses?: Record<string, string>;
}

/**
 * User configuration (what users write in movehat.config.ts)
 */
export interface MovehatUserConfig {
    defaultNetwork?: string;
    networks: Record<string, NetworkConfig>;
    accounts?: string[]; // Global accounts (Hardhat-style)
    moveDir?: string;
    namedAddresses?: Record<string, string>;
}

/**
 * Resolved configuration (internal use - what runtime uses)
 */
export interface MovehatConfig {
    network: string;              // Active network name
    rpc: string;                  // RPC endpoint
    privateKey: string;           // Primary account (accounts[0])
    allAccounts: string[];        // All accounts for this network
    profile: string;              // Movement CLI profile
    moveDir: string;              // Move source directory
    account: string;              // Account address (derived from privateKey)
    namedAddresses: Record<string, string>; // Merged named addresses
    networkConfig: NetworkConfig; // Full network configuration
}

/**
 * Testing mode for local environment
 */
export type LocalTestingMode = 'local-node' | 'fork';

/**
 * Options for setting up local testing environment
 */
export interface LocalTestOptions {
    mode?: LocalTestingMode;            // Testing mode: 'local-node' (full blockchain) or 'fork' (read-only snapshot) (default: 'local-node')

    // Local Node options (when mode='local-node')
    nodeTestDir?: string;               // Directory for node data (default: .movehat/local-node)
    nodeForceRestart?: boolean;         // Clean node state and start fresh (default: true)
    nodeFaucetPort?: number;            // Faucet port for local node (default: 8081)
    nodeApiPort?: number;               // API/RPC port for local node (default: 8080)
    nodeReadyPort?: number;             // Ready server port (default: 8070)
    nodeSilent?: boolean;               // Suppress node output (default: false)

    // Fork options (when mode='fork')
    forkNetwork?: 'testnet' | string;   // Network to fork from (default: 'testnet')
    forkName?: string;                  // Name for the fork (default: 'test-local')
    forkPort?: number;                  // Fork server port (default: 8080)
    forkResetState?: boolean;           // Clear fork state before tests (default: true)

    // Common options (both modes)
    autoFund?: boolean;                 // Auto-fund accounts (default: true)
    defaultBalance?: number;            // Default balance in octas (default: 100_000_000 = 100 APT)
    autoDeploy?: readonly string[];     // Modules to auto-deploy (accepts readonly arrays)
    accountLabels?: readonly string[];  // Labels for pre-generated accounts (default: ['deployer', 'alice', 'bob'])
}