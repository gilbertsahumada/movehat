import { describe, expect, it } from "vitest";
import * as publicSurface from "../index.js";

/**
 * Locks the public export surface of `movehat`. Adding a new symbol
 * is a deliberate API change; removing one is a breaking change.
 * Update this list (and the CHANGELOG) when the surface evolves.
 */
const EXPECTED_RUNTIME_EXPORTS = [
  "Harness",
  "HarnessDisposedError",
  "ForkManager",
  "MovementApiClient",
  "ForkStorage",
  "ForkServer",
  "ModuleAlreadyDeployedError",
  "PostPublishError",
  "InvalidPersistedStateError",
  "TransactionOutcomeUnknownError",
  "initRuntime",
] as const;

describe("public export surface (movehat root)", () => {
  it.each(EXPECTED_RUNTIME_EXPORTS)("exports %s as a runtime value", (name) => {
    expect(publicSurface[name as keyof typeof publicSurface]).toBeDefined();
  });

  // Type-only exports cannot be probed at runtime; the assertion is
  // that the module imports successfully (failing types-only export
  // would surface as a TS error in `pnpm check:example`).
  it("imports without errors", () => {
    expect(typeof publicSurface).toBe("object");
  });
});
