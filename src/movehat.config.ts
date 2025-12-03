import dotenv from "dotenv";
dotenv.config();

export default {
  network: "movement-testnet",
  rpc: "https://testnet.movementnetwork.xyz/v1",
  profile: "default",
  account:
    "0x662a2aa90fdf2b8e400640a49fc922b713fe4baaec8c37b088ecef315561e4d9",
  privateKey:
    "0xc756bfb85dc68b9df2837d5b91183e96e8e67a9a0641001fb453c4457d093dcb",

  moveDir: "./move", // carpeta donde está tu Move.toml
  namedAddresses: {
    counter: process.env.MH_ACCOUNT ?? "0x0",
  },
};
