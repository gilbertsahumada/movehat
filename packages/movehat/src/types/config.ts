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