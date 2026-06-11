import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  configureLogger,
  isVerbose,
  getVerbosityLevel,
  divider,
  phase,
} from "../logger.js";

describe("logger — verbosity", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.MOVEHAT_VERBOSE;
    // Start each test from a clean slate so prior runs cannot leak.
    delete process.env.MOVEHAT_VERBOSE;
    configureLogger({ verbosity: "normal" });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MOVEHAT_VERBOSE;
    } else {
      process.env.MOVEHAT_VERBOSE = originalEnv;
    }
    configureLogger({ verbosity: "normal" });
  });

  it("defaults to non-verbose when MOVEHAT_VERBOSE is unset and config is normal", () => {
    expect(isVerbose()).toBe(false);
  });

  it("returns true when MOVEHAT_VERBOSE=1 (env-driven path)", () => {
    process.env.MOVEHAT_VERBOSE = "1";
    expect(isVerbose()).toBe(true);
  });

  it("returns true when configureLogger({ verbosity: 'verbose' }) is set in-process", () => {
    configureLogger({ verbosity: "verbose" });
    expect(isVerbose()).toBe(true);
  });

  it("env var wins even when in-process config is normal (allows shell-script callers)", () => {
    configureLogger({ verbosity: "normal" });
    process.env.MOVEHAT_VERBOSE = "1";
    expect(isVerbose()).toBe(true);
  });

  it("non-'1' MOVEHAT_VERBOSE values do not enable verbose mode", () => {
    process.env.MOVEHAT_VERBOSE = "true";
    expect(isVerbose()).toBe(false);
    process.env.MOVEHAT_VERBOSE = "0";
    expect(isVerbose()).toBe(false);
  });
});

describe("logger — getVerbosityLevel", () => {
  let origLevel: string | undefined;
  let origVerbose: string | undefined;

  beforeEach(() => {
    origLevel = process.env.MOVEHAT_VERBOSITY;
    origVerbose = process.env.MOVEHAT_VERBOSE;
    delete process.env.MOVEHAT_VERBOSITY;
    delete process.env.MOVEHAT_VERBOSE;
  });

  afterEach(() => {
    if (origLevel === undefined) delete process.env.MOVEHAT_VERBOSITY;
    else process.env.MOVEHAT_VERBOSITY = origLevel;
    if (origVerbose === undefined) delete process.env.MOVEHAT_VERBOSE;
    else process.env.MOVEHAT_VERBOSE = origVerbose;
  });

  it("defaults to 0 when neither env var is set", () => {
    expect(getVerbosityLevel()).toBe(0);
  });

  it("reads the numeric level from MOVEHAT_VERBOSITY", () => {
    for (const n of [0, 1, 2, 3, 4]) {
      process.env.MOVEHAT_VERBOSITY = String(n);
      expect(getVerbosityLevel()).toBe(n);
    }
  });

  it("clamps out-of-range values into 0..4", () => {
    process.env.MOVEHAT_VERBOSITY = "9";
    expect(getVerbosityLevel()).toBe(4);
    process.env.MOVEHAT_VERBOSITY = "-3";
    expect(getVerbosityLevel()).toBe(0);
  });

  it("ignores a non-numeric MOVEHAT_VERBOSITY and falls through", () => {
    process.env.MOVEHAT_VERBOSITY = "loud";
    expect(getVerbosityLevel()).toBe(0);
    process.env.MOVEHAT_VERBOSITY = "loud";
    process.env.MOVEHAT_VERBOSE = "1";
    expect(getVerbosityLevel()).toBe(1);
  });

  it("falls back to level 1 for the legacy MOVEHAT_VERBOSE=1 when MOVEHAT_VERBOSITY is unset", () => {
    process.env.MOVEHAT_VERBOSE = "1";
    expect(getVerbosityLevel()).toBe(1);
  });

  it("MOVEHAT_VERBOSITY takes precedence over the legacy MOVEHAT_VERBOSE", () => {
    process.env.MOVEHAT_VERBOSE = "1";
    process.env.MOVEHAT_VERBOSITY = "3";
    expect(getVerbosityLevel()).toBe(3);
  });
});

describe("logger.phase / logger.divider", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    configureLogger({ silent: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("phase prints three lines: top rule, indented title, bottom rule", () => {
    phase("Local Movement node");
    expect(logSpy).toHaveBeenCalledTimes(3);

    const calls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    // The title line carries the supplied text after the two-space indent.
    expect(calls[1]).toContain("Local Movement node");
    // Top and bottom rules should be identical (same width, same color).
    expect(calls[0]).toBe(calls[2]);
  });

  it("divider prints a single muted rule line", () => {
    divider();
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0]?.[0] ?? "");
    // The rule character is `━` (BOX DRAWINGS HEAVY HORIZONTAL).
    expect(line).toMatch(/━+/);
  });

  it("phase and divider are silenced when configureLogger({ silent: true })", () => {
    configureLogger({ silent: true });
    phase("hidden phase");
    divider();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
