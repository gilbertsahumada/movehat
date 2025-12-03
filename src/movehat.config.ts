import dotenv from "dotenv";
dotenv.config();

const accountAddress = process.env.MH_ACCOUNT;
const privateKey = process.env.MH_PRIVATE_KEY;

if(!accountAddress || !privateKey) {
  throw new Error("MH_ACCOUNT and MH_PRIVATE_KEY must be set in environment variables.");
}

export default {
  network: "movement-testnet",
  rpc: "https://testnet.movementnetwork.xyz/v1",
  profile: "default",
  account:
    process.env.MH_ACCOUNT || "",
  privateKey:
    process.env.MH_PRIVATE_KEY || "",

  moveDir: "./move", // folder where is your Move.toml
  namedAddresses: {
    counter: process.env.MH_ACCOUNT ?? "0x0",
  },
};
