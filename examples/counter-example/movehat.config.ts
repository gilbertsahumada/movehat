import dotenv from "dotenv";
dotenv.config();

export default {
  network: process.env.MH_NETWORK ?? "testnet",
  rpc: process.env.MH_RPC ?? "https://testnet.movementnetwork.xyz/v1",
  profile: "default",
  account: process.env.MH_ACCOUNT || "",
  privateKey: process.env.MH_PRIVATE_KEY || "",
  moveDir: "./move",
  namedAddresses: {
    counter: process.env.MH_ACCOUNT ?? "0x0",
  },
};
