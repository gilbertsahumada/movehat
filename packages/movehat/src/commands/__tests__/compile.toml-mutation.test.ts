import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol, fs as memfsFs } from "memfs";

vi.mock("fs", () => {
  return {
    default: memfsFs,
    ...memfsFs,
  };
});

import { updateMoveToml } from "../compile.js";

/**
 * F7 — `movehat compile` mutates `Move.toml` when it detects a named
 * address that isn't declared yet. This test pins down the current
 * behavior so a future change (introducing a `--write` flag, moving
 * the mutation to a dedicated `movehat update-toml` command, etc.)
 * MUST update this test alongside the source change.
 *
 * Audit finding F7 is marked "no concluyente — requires product
 * decision": the mutation may be the right UX default for the
 * Hardhat-style workflow, but the asymmetry (compile reading + writing)
 * deserves to be a deliberate choice. See ROADMAP follow-up.
 */
describe("F7 — updateMoveToml mutates Move.toml on disk (current behavior captured)", () => {
  beforeEach(() => vol.reset());
  afterEach(() => vol.reset());

  it("writes new named addresses into [addresses] and [dev-addresses] when missing", () => {
    const before = `[package]
name = "captured"
version = "1.0.0"

[addresses]
existing = "_"

[dev-addresses]
existing = "0xcafe"

[dependencies]
`;
    vol.fromJSON({ "/move/Move.toml": before });

    const detected = new Set(["existing", "audit_module"]);
    const added = updateMoveToml("/move", detected);

    expect(added).toEqual(["audit_module"]);

    // Source-of-truth assertion: the on-disk file CHANGED. F7 is the
    // observation that a "compile" verb has a side effect on the user's
    // working tree. The behavior is captured here so an unintended
    // regression (or a deliberate revisit) cannot land silently.
    const after = vol.readFileSync("/move/Move.toml", "utf-8") as string;
    expect(after).not.toBe(before);
    expect(after).toContain("audit_module = \"_\"");
  });

  it("returns an empty list and leaves Move.toml byte-identical when all named addresses are already declared", () => {
    const before = `[package]
name = "captured"

[addresses]
existing = "_"

[dev-addresses]
existing = "0xcafe"
`;
    vol.fromJSON({ "/move/Move.toml": before });

    const added = updateMoveToml("/move", new Set(["existing"]));
    expect(added).toEqual([]);
    // No mutation in the no-op path — the asymmetry only triggers when
    // detected ⊄ declared. Useful boundary for the F7 product decision.
    const after = vol.readFileSync("/move/Move.toml", "utf-8") as string;
    expect(after).toBe(before);
  });
});
