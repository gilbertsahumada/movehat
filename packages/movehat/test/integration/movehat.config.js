/**
 * Minimal movehat config for the integration suite.
 *
 * `Harness.createLocal` injects its own `local` network override via
 * `initRuntime({ configOverride })`, so the values here only need to
 * make `loadUserConfig` succeed. `testnet` is wired for the fork-mode
 * suite, gated on `MOVEMENT_RPC_URL`.
 *
 * Authored as `.js` (not `.ts`) on purpose: `loadUserConfig` uses
 * `tsx/esm/api` to load `.ts` configs, which conflicts with vitest's
 * own ESM loader and yields `Invalid loader value: "<pid>"`. The plain
 * `import()` path used for `.js` configs avoids the collision.
 */
export default {
  defaultNetwork: "local",
  networks: {
    local: { url: "http://localhost:8080/v1", chainId: "local" },
    testnet: {
      url: process.env.MOVEMENT_RPC_URL ?? "https://testnet.movementnetwork.xyz/v1",
      chainId: "testnet",
    },
  },
  accounts: [],
  moveDir: "./fixtures/move/v1",
};
