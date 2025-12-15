import dotenv from "dotenv";
dotenv.config();

export default {
  // Default network to use when no --network flag is provided
  // "testnet" = Movement testnet (public, auto-generates test accounts)
  // "mainnet" = Movement mainnet (requires PRIVATE_KEY in .env)
  // "local" = Fork server running on localhost:8080
  defaultNetwork: "testnet",

  // Network configurations
  networks: {
    // Movement Testnet - Public test network (recommended for development)
    // Auto-generates test accounts - no local setup required
    // Perfect for running tests with transaction simulation
    testnet: {
      url: process.env.MOVEMENT_RPC_URL || "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet",
    },
    // Movement Mainnet - Production network
    // REQUIRES PRIVATE_KEY in .env - uses real MOVE tokens
    mainnet: {
      url: "https://mainnet.movementnetwork.xyz/v1",
      chainId: "mainnet",
    },
    // Local fork server (requires: movehat fork serve)
    // Useful for testing against a snapshot of real network state
    local: {
      url: "http://localhost:8080/v1",
      chainId: "local",
    },
  },

  // Global accounts configuration (Hardhat-style)
  // Uses PRIVATE_KEY from .env by default
  // You can also specify accounts here directly:
  // accounts: ["0x1234..."],
  accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],

  // Global settings
  moveDir: "./move",

  // Named addresses (can be overridden per-network in network config)
  namedAddresses: {
    // Example: counter: "0x1234...",
  },
};
