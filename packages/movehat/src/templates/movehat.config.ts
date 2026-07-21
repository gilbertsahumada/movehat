// Movehat configuration.
//
// Movehat's primary public API is the Hardhat-style `Harness` class
// (see scripts/deploy-counter.ts and tests/Counter.test.ts in this
// template). The `Harness.create*` factories read this file via
// `loadUserConfig` to resolve the active network + accounts.
//
// The `setupTestFixture()` helper also reads the same shape and
// remains supported as a lighter-weight alternative to Harness.

import dotenv from "dotenv";
dotenv.config();

export default {
  // Default network to use when no --network flag is provided
  // "local" = self-contained local chain (movelite when available,
  // otherwise Movement node); no credentials required
  // "testnet" = Movement testnet (public, requires an explicit account)
  // "mainnet" = Movement mainnet (requires PRIVATE_KEY in .env)
  defaultNetwork: "local",

  // Network configurations
  networks: {
    // Movement Testnet - Public test network. Set PRIVATE_KEY before
    // selecting this network; the default workflow never contacts it.
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
    // Local endpoints are injected by Harness.createLocal at runtime.
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
