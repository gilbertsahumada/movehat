import dotenv from "dotenv";
dotenv.config();

export default {
  network: "movement-testnet",
  rpc: "https://testnet.movementnetwork.xyz/v1",
  profile: "default",
  account: process.env.MH_ACCOUNT!,
  privateKey: process.env.MH_PRIVATE_KEY!,

  moveDir: "./move" // carpeta donde está tu Move.toml
};
