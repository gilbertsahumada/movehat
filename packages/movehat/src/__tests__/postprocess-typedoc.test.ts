import { describe, it, expect } from "vitest";

// Imports the side-effect-gated helper from `scripts/postprocess-typedoc.mjs`.
// Lives in src/__tests__ because vitest's `include` glob is scoped to
// `src/**/__tests__/**/*.test.ts` (see vitest.config.ts:7). The script
// itself runs `processDir(referenceDir)` only when invoked via the
// `if (isMain)` gate, so importing here is safe — no filesystem writes
// happen at import time.
import { groupPagesByCategory } from "../../scripts/postprocess-typedoc.mjs";

describe("groupPagesByCategory", () => {
  it("interleaves Fumadocs separators in CATEGORY_ORDER", () => {
    const pages = ["AccountManager", "ForkManager", "Harness", "MoveContract"];
    const result = groupPagesByCategory(pages);

    expect(result).toEqual([
      "---Harness---",
      "Harness",
      "---Account---",
      "AccountManager",
      "---Contract---",
      "MoveContract",
      "---Fork---",
      "ForkManager",
    ]);
  });

  it("preserves alphabetical order within each category", () => {
    const pages = ["ForkServer", "ForkManager", "MovementApiClient"];
    const result = groupPagesByCategory(pages);

    // Caller is expected to pass alphabetically sorted input — the helper
    // preserves that order within each category bucket.
    expect(result).toEqual([
      "---Fork---",
      "ForkServer",
      "ForkManager",
      "MovementApiClient",
    ]);
  });

  it("drops empty categories from the output", () => {
    const pages = ["Harness", "PostPublishError"];
    const result = groupPagesByCategory(pages);

    // Only Harness and Errors should appear — Account / Contract / Fork /
    // Deployment Helpers / Other have zero items, no separator emitted.
    expect(result).toEqual([
      "---Harness---",
      "Harness",
      "---Errors---",
      "PostPublishError",
    ]);
  });

  it("falls unknown symbols through to the Other bucket", () => {
    const pages = ["Harness", "totally-new-symbol"];
    const result = groupPagesByCategory(pages);

    expect(result).toEqual([
      "---Harness---",
      "Harness",
      "---Other---",
      "totally-new-symbol",
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupPagesByCategory([])).toEqual([]);
  });
});
