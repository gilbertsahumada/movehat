import dotenv from "dotenv";
dotenv.config();

export default {
  // Default network to use when no --network flag is provided
  defaultNetwork: "testnet",

  // Network configurations
  networks: {
    testnet: {
      url: process.env.MH_TESTNET_RPC || "https://testnet.movementnetwork.xyz/v1",
      accounts: [process.env.MH_TESTNET_PRIVATE_KEY || process.env.MH_PRIVATE_KEY || ""],
      chainId: "testnet",
      profile: "default",
    },
    mainnet: {
      url: process.env.MH_MAINNET_RPC || "https://mainnet.movementnetwork.xyz/v1",
      accounts: [process.env.MH_MAINNET_PRIVATE_KEY || ""],
      chainId: "mainnet",
      profile: "default",
    },
    local: {
      url: process.env.MH_LOCAL_RPC || "http://localhost:8080/v1",
      accounts: [process.env.MH_LOCAL_PRIVATE_KEY || ""],
      chainId: "local",
      profile: "default",
    },
  },

  // Global settings
  moveDir: "./move",

  // Named addresses (can be overridden per-network in network config)
  namedAddresses: {
    counter: process.env.MH_ACCOUNT || "0x0",
  },
};
