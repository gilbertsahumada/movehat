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

const initModule = await import("../init.js");
const { default: initCommand, resolveProjectNames, InvalidProjectNameError } = initModule;

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

describe("resolveProjectNames", () => {
  const cases: Array<[
    string,
    { dirName: string; npmName: string; moveName: string; sanitized: boolean }
  ]> = [
    ["my_project", { dirName: "my_project", npmName: "my_project", moveName: "my_project", sanitized: false }],
    ["my-project", { dirName: "my-project", npmName: "my-project", moveName: "my_project", sanitized: true }],
    ["/tmp/my-project", { dirName: "/tmp/my-project", npmName: "my-project", moveName: "my_project", sanitized: true }],
    ["123abc", { dirName: "123abc", npmName: "123abc", moveName: "pkg_123abc", sanitized: true }],
    ["_underscore", { dirName: "_underscore", npmName: "_underscore", moveName: "_underscore", sanitized: false }],
    ["UPPER", { dirName: "UPPER", npmName: "UPPER", moveName: "UPPER", sanitized: false }],
    ["  spaced  ", { dirName: "spaced", npmName: "spaced", moveName: "spaced", sanitized: false }],
    ["with spaces", { dirName: "with spaces", npmName: "with spaces", moveName: "with_spaces", sanitized: true }],
  ];

  it.each(cases)("derives names for %j", (input, expected) => {
    expect(resolveProjectNames(input)).toEqual(expected);
  });

  it.each(["", "   ", ".", "..", "/", "////"])(
    "rejects %j as an invalid project name",
    (input) => {
      expect(() => resolveProjectNames(input)).toThrow(InvalidProjectNameError);
    }
  );
});

describe("initCommand", () => {
  let tmpParent: string;
  let origCwd: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

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
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (existsSync(tmpParent)) {
      rmSync(tmpParent, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("happy path: scaffolds a project from the canonical template", async () => {
    await initCommand("my_test_project");

    const target = join(tmpParent, "my_test_project");
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
    // Move.toml gets a valid Move identifier.
    const moveToml = readFileSync(join(target, "move", "Move.toml"), "utf-8");
    expect(moveToml).toContain('name = "my_test_project"');
    expect(moveToml).not.toContain("{{movePackageName}}");
    expect(moveToml).not.toContain("{{projectName}}");
  });

  it("substitutes {{projectName}} placeholders inside template files", async () => {
    await initCommand("substituted_project");

    const pkg = readFileSync(
      join(tmpParent, "substituted_project", "package.json"),
      "utf-8"
    );
    expect(pkg).toContain("substituted_project");
    expect(pkg).not.toContain("{{projectName}}");

    const readme = readFileSync(
      join(tmpParent, "substituted_project", "README.md"),
      "utf-8"
    );
    expect(readme).toContain("substituted_project");
  });

  it("prompts for project name when none is provided", async () => {
    promptsMock.mockResolvedValueOnce({ projectName: "from_prompt" });

    await initCommand();

    expect(promptsMock).toHaveBeenCalledTimes(1);
    expect(existsSync(join(tmpParent, "from_prompt"))).toBe(true);
  });

  it("exits 0 when the user Ctrl+Cs the prompt (no project created)", async () => {
    promptsMock.mockResolvedValueOnce({});

    await expect(initCommand()).rejects.toThrow("__test_exit_0__");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 when the template copy step hits an unwriteable target", async () => {
    // Plant a directory where the command will try to write package.json
    // as a file — fs.writeFile rejects with EISDIR.
    const targetName = "blocked_project";
    mkdirSync(join(tmpParent, targetName, "package.json"), { recursive: true });

    await expect(initCommand(targetName)).rejects.toThrow("__test_exit_1__");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sanitizes Move.toml for hyphenated names but keeps package.json original", async () => {
    await initCommand("my-project");

    const target = join(tmpParent, "my-project");
    expect(existsSync(target)).toBe(true);
    // package.json keeps the original (npm allows hyphens).
    const pkg = readFileSync(join(target, "package.json"), "utf-8");
    expect(pkg).toContain('"my-project"');
    // Move.toml gets the sanitized identifier.
    const moveToml = readFileSync(join(target, "move", "Move.toml"), "utf-8");
    expect(moveToml).toContain('name = "my_project"');
    expect(moveToml).not.toContain('"my-project"');
    // Warning was emitted.
    expect(warnSpy).toHaveBeenCalled();
    const warningText = warnSpy.mock.calls.flat().join(" ");
    expect(warningText).toContain("my-project");
    expect(warningText).toContain("my_project");
  });

  it("with a path argument, creates the dir at the full path and sanitizes Move.toml", async () => {
    const nestedPath = join(tmpParent, "nested", "sub-project");

    await initCommand(nestedPath);

    expect(existsSync(nestedPath)).toBe(true);
    const moveToml = readFileSync(join(nestedPath, "move", "Move.toml"), "utf-8");
    expect(moveToml).toContain('name = "sub_project"');
    const pkg = readFileSync(join(nestedPath, "package.json"), "utf-8");
    expect(pkg).toContain('"sub-project"');
  });

  it("prefixes Move.toml package name with pkg_ for names that start with a digit", async () => {
    await initCommand("123abc");

    const moveToml = readFileSync(
      join(tmpParent, "123abc", "move", "Move.toml"),
      "utf-8"
    );
    expect(moveToml).toContain('name = "pkg_123abc"');
    expect(warnSpy).toHaveBeenCalled();
  });

  it.each([".", "..", "/", "   "])(
    "rejects %j as an invalid project name and exits 1",
    async (input) => {
      await expect(initCommand(input)).rejects.toThrow("__test_exit_1__");
      expect(exitSpy).toHaveBeenCalledWith(1);
    }
  );
});
