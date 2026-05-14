import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const promptsMock = vi.fn();
vi.mock("prompts", () => ({
  default: promptsMock,
}));

// Silence the ASCII banner.
vi.mock("../../helpers/banner.js", () => ({
  printMovehatBanner: () => undefined,
}));

const { default: initCommand } = await import("../init.js");

/**
 * Strategy: real tmpdir + real fs ops (matches §6.1's example-as-canonical
 * scaffold philosophy — if `init` can't actually copy files end-to-end,
 * users land on a broken state). We chdir into a fresh tmp parent for
 * each test and verify the target project directory was created and
 * contains the expected files.
 *
 * The Move templates ship at `src/templates/` in the source tree; when
 * vitest runs the TS source, `__dirname` of `init.ts` resolves to
 * `src/commands/` so `path.join(__dirname, "..", "templates")` resolves
 * to `src/templates/` cleanly. No bundling step required.
 */

describe("initCommand", () => {
  let tmpParent: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    promptsMock.mockReset();
    origCwd = process.cwd();
    tmpParent = mkdtempSync(join(tmpdir(), "movehat-init-test-"));
    process.chdir(tmpParent);
    // Throw a sentinel error so flow actually aborts (in real CLI usage
    // process.exit terminates the process; for tests we need it to break
    // out of the rest of init.ts via a thrown error).
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`__test_exit_${code ?? 0}__`);
      }) as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpParent)) {
      rmSync(tmpParent, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("happy path: scaffolds a project from the canonical template", async () => {
    await initCommand("my-test-project");

    const target = join(tmpParent, "my-test-project");
    expect(existsSync(target)).toBe(true);
    // Canonical files at the project root.
    expect(existsSync(join(target, "package.json"))).toBe(true);
    expect(existsSync(join(target, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(target, ".mocharc.json"))).toBe(true);
    expect(existsSync(join(target, "movehat.config.ts"))).toBe(true);
    expect(existsSync(join(target, ".env.example"))).toBe(true);
    expect(existsSync(join(target, ".gitignore"))).toBe(true);
    expect(existsSync(join(target, "README.md"))).toBe(true);
    // Subdirectories with their own files.
    expect(existsSync(join(target, "move"))).toBe(true);
    expect(existsSync(join(target, "scripts"))).toBe(true);
    expect(existsSync(join(target, "tests"))).toBe(true);
    // Excluded template-development directory.
    expect(existsSync(join(target, "types"))).toBe(false);
    expect(existsSync(join(target, ".vscode"))).toBe(false);
  });

  it("substitutes {{projectName}} placeholders inside template files", async () => {
    await initCommand("substituted-project");

    const pkg = readFileSync(
      join(tmpParent, "substituted-project", "package.json"),
      "utf-8"
    );
    expect(pkg).toContain("substituted-project");
    expect(pkg).not.toContain("{{projectName}}");

    const readme = readFileSync(
      join(tmpParent, "substituted-project", "README.md"),
      "utf-8"
    );
    expect(readme).toContain("substituted-project");
  });

  it("prompts for project name when none is provided", async () => {
    promptsMock.mockResolvedValueOnce({ projectName: "from-prompt" });

    await initCommand();

    expect(promptsMock).toHaveBeenCalledTimes(1);
    expect(existsSync(join(tmpParent, "from-prompt"))).toBe(true);
  });

  it("exits 0 when the user Ctrl+Cs the prompt (no project created)", async () => {
    promptsMock.mockResolvedValueOnce({});

    await expect(initCommand()).rejects.toThrow("__test_exit_0__");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 when the template copy step hits an unwriteable target", async () => {
    // Plant a directory where the command will try to write package.json
    // as a file — fs.writeFile rejects with EISDIR.
    const targetName = "blocked-project";
    mkdirSync(join(tmpParent, targetName, "package.json"), { recursive: true });

    await expect(initCommand(targetName)).rejects.toThrow("__test_exit_1__");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
