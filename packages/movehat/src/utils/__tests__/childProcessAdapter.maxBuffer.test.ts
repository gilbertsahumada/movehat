import { describe, expect, it } from "vitest";
import { defaultChildProcessAdapter } from "../childProcessAdapter.js";

/**
 * F4 — `run()` must reject when child output exceeds `maxBuffer`.
 *
 * Without this cap, the stdout/stderr Buffer arrays in
 * DefaultChildProcessAdapter grow without limit. A buggy or hostile
 * subprocess can OOM the parent process. F4 adds an opt-in byte cap
 * with kill-on-overflow semantics.
 */

const NODE = process.execPath;

describe("F4 — ChildProcessAdapter.run maxBuffer", () => {
  it("rejects with a maxBuffer error when stdout exceeds the cap", async () => {
    // 8KiB of output, cap at 1KiB → must abort.
    const script = `process.stdout.write('x'.repeat(8 * 1024)); setTimeout(() => {}, 30000);`;
    await expect(
      defaultChildProcessAdapter.run({
        command: NODE,
        args: ["-e", script],
        maxBuffer: 1024,
        timeoutMs: 10_000,
      })
    ).rejects.toThrow(/maxBuffer|exceeded/i);
  });

  it("rejects with a maxBuffer error when stderr exceeds the cap", async () => {
    const script = `process.stderr.write('y'.repeat(8 * 1024)); setTimeout(() => {}, 30000);`;
    await expect(
      defaultChildProcessAdapter.run({
        command: NODE,
        args: ["-e", script],
        maxBuffer: 1024,
        timeoutMs: 10_000,
      })
    ).rejects.toThrow(/maxBuffer|exceeded/i);
  });

  it("does NOT throw when output stays under the cap", async () => {
    const script = `process.stdout.write('ok'); process.exit(0);`;
    const result = await defaultChildProcessAdapter.run({
      command: NODE,
      args: ["-e", script],
      maxBuffer: 1024,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
  });
});
