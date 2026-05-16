import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalNodeManager } from "../LocalNodeManager.js";
import { logger } from "../../ui/index.js";

/**
 * F9 — `apiPort` must not lie about where the node listens.
 *
 * `movement node run-localnet` (Movement CLI 7.4.0) does NOT accept a
 * flag to change the REST API port. It always binds 8080. Earlier
 * versions of LocalNodeManager accepted `apiPort: 9000` from the
 * caller, stored it, and surfaced `http://127.0.0.1:9000` from
 * `getNodeInfo()` — but the actual node was still on 8080. That
 * mismatch would silently surface as "Movement command failed" with
 * no useful signal. F9 closes the gap by refusing to lie: the
 * effective port is 8080 regardless of what the caller passes, with a
 * warning when they pass anything else.
 */

describe("F9 — LocalNodeManager apiPort is constrained to 8080", () => {
  let tmpDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "movehat-f9-"));
    warnSpy = vi.spyOn(logger, "warning").mockImplementation(() => undefined);
    vi.spyOn(logger, "step").mockImplementation(() => undefined);
    vi.spyOn(logger, "plain").mockImplementation(() => undefined);
    vi.spyOn(logger, "newline").mockImplementation(() => undefined);
    vi.spyOn(logger, "success").mockImplementation(() => undefined);
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ignores non-default apiPort, forces 8080, and warns", () => {
    const mgr = new LocalNodeManager({ testDir: tmpDir, apiPort: 9000 });
    expect(mgr.getNodeInfo().rpcUrl).toBe("http://127.0.0.1:8080");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]?.[0] as string;
    expect(msg).toMatch(/8080/);
    expect(msg).toMatch(/apiPort|REST API port/i);
  });

  it("accepts apiPort: 8080 without warning", () => {
    const mgr = new LocalNodeManager({ testDir: tmpDir, apiPort: 8080 });
    expect(mgr.getNodeInfo().rpcUrl).toBe("http://127.0.0.1:8080");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("accepts omitted apiPort without warning (default path)", () => {
    const mgr = new LocalNodeManager({ testDir: tmpDir });
    expect(mgr.getNodeInfo().rpcUrl).toBe("http://127.0.0.1:8080");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
