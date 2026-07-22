import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import prompts from "prompts";
import { printMovehatBanner } from "../helpers/banner.js";
import { logger, createSpinnerChain, formatCommand } from "../ui/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class InvalidProjectNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProjectNameError";
  }
}

export interface ProjectNames {
  /** User input as-is (after trim) — used for the filesystem target. */
  dirName: string;
  /** Basename of the resolved path — used for package.json + README.md. */
  npmName: string;
  /** Valid Move identifier — used for Move.toml. */
  moveName: string;
  /** True when moveName had to diverge from npmName to satisfy Move identifier rules. */
  sanitized: boolean;
}

export interface InitOptions {
  /** Overwrite template-owned files when the destination already exists. */
  force?: boolean;
  /** Test hook; normal callers should let Movehat detect the terminal. */
  interactive?: boolean;
}

/**
 * Derive filesystem, npm, and Move identifier names from a single user input.
 *
 * Move identifiers must match `[a-zA-Z_][a-zA-Z0-9_]*`. npm package names are
 * looser (hyphens allowed). The filesystem accepts almost anything. Rather
 * than reject inputs that would compile fine for npm but not for Move, we
 * sanitize the Move identifier and leave the npm name + dir unchanged.
 */
export function resolveProjectNames(input: string): ProjectNames {
  const trimmed = input.trim();
  if (
    trimmed === "" ||
    trimmed === "." ||
    trimmed === ".." ||
    /^\/+$/.test(trimmed)
  ) {
    throw new InvalidProjectNameError(
      `Project name '${input}' must include at least one character besides path separators.`
    );
  }

  const dirName = trimmed;
  const npmName = path.basename(path.resolve(trimmed));
  let moveName = npmName.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!/^[a-zA-Z_]/.test(moveName)) {
    moveName = `pkg_${moveName}`;
  }

  return {
    dirName,
    npmName,
    moveName,
    sanitized: moveName !== npmName,
  };
}

/**
 * Initialize a new Movehat project with template files
 *
 * Creates a complete project structure including:
 * - Configuration files (movehat.config.ts, .env, .gitignore, package.json)
 * - Move smart contract templates
 * - Deployment scripts
 * - Test files
 *
 * @param projectName - Optional project name. If not provided, user will be prompted
 *
 * @example
 * // With project name
 * await initCommand('my-project');
 *
 * @example
 * // Interactive prompt
 * await initCommand();
 */
export default async function initCommand(
  projectName?: string,
  options: InitOptions = {}
) {
  // Show banner only on init command
  printMovehatBanner();

  // if name is not given
  if (!projectName) {
    const interactive =
      options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!interactive) {
      throw new Error(
        "Project name is required in non-interactive mode: movehat init <project-name>"
      );
    }
    const response = await prompts({
      type: 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'first-project'
    });

    // If the user cancels (Ctrl+C), exit
    if (!response.projectName) {
      logger.warning('Project initialization cancelled.');
      process.exit(0);
    }

    projectName = response.projectName;
  }

  let names: ProjectNames;
  try {
    names = resolveProjectNames(projectName!);
  } catch (error) {
    if (error instanceof InvalidProjectNameError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const { dirName, npmName, moveName, sanitized } = names;
  const projectPath = path.resolve(process.cwd(), dirName);

  if (sanitized) {
    logger.warning(
      `'${npmName}' is not a valid Move identifier; using '${moveName}' for move/Move.toml. (package.json keeps '${npmName}'.)`
    );
  }

  logger.newline();
  logger.info(`Initializing new Movehat project in ${projectPath}...`);
  logger.newline();

  try {
    const destinationExists = await fs
      .stat(projectPath)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });

    if (destinationExists && !options.force) {
      const interactive =
        options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (!interactive) {
        throw new Error(
          `Destination already exists: ${projectPath}. Re-run with --force to overwrite template files.`
        );
      }

      const response = await prompts({
        type: "confirm",
        name: "overwrite",
        message: `Destination '${dirName}' already exists. Overwrite template files?`,
        initial: false,
      });
      if (!response.overwrite) {
        logger.warning("Project initialization cancelled; no files were changed.");
        return;
      }
    }

    const templatesDir = path.join(__dirname, "..", "templates");
    const packageManifest = JSON.parse(
      await fs.readFile(path.join(__dirname, "..", "..", "package.json"), "utf-8")
    ) as { version?: unknown };
    const movehatVersion = String(packageManifest.version ?? "");
    if (!movehatVersion) {
      throw new Error("Missing version in the Movehat package manifest");
    }
    const steps = createSpinnerChain();

    // Step 1: Create project structure
    await steps.add('Creating project structure', async () => {
      await fs.mkdir(projectPath, { recursive: true });

      await copyFile(
        path.join(templatesDir, "package.json"),
        path.join(projectPath, "package.json"),
        { projectName: npmName, movehatVersion }
      );

      await copyFile(
        path.join(templatesDir, "tsconfig.json"),
        path.join(projectPath, "tsconfig.json")
      );

      await copyFile(
        path.join(templatesDir, ".mocharc.json"),
        path.join(projectPath, ".mocharc.json")
      );

      await copyFile(
        path.join(templatesDir, "movehat.config.ts"),
        path.join(projectPath, "movehat.config.ts")
      );

      await copyFile(
        path.join(templatesDir, ".env.example"),
        path.join(projectPath, ".env.example")
      );

      await copyFile(
        path.join(templatesDir, "gitignore"),
        path.join(projectPath, ".gitignore")
      );

      await copyFile(
        path.join(templatesDir, "README.md"),
        path.join(projectPath, "README.md"),
        { projectName: npmName }
      );
    });

    // Step 2: Setup Move project
    await steps.add('Setting up Move project', async () => {
      await copyDir(
        path.join(templatesDir, "move"),
        path.join(projectPath, "move"),
        { projectName: npmName, movePackageName: moveName }
      );
    });

    // Step 3: Add deployment scripts
    await steps.add('Adding deployment scripts', async () => {
      await copyDir(
        path.join(templatesDir, "scripts"),
        path.join(projectPath, "scripts")
      );
    });

    // Step 4: Add test files
    await steps.add('Adding test files', async () => {
      await copyDir(
        path.join(templatesDir, "tests"),
        path.join(projectPath, "tests")
      );
    });

    steps.complete();

    // Success message
    logger.newline();
    logger.success('Project created successfully!');
    logger.newline();

    // Next steps
    logger.section('Next steps');
    logger.item(formatCommand(`cd ${dirName}`), 2);
    logger.item(formatCommand('cp .env.example .env'), 2);
    logger.plain('     # Edit .env with your credentials');
    logger.item(formatCommand('npm install'), 2);
    logger.item(formatCommand('npx movehat compile'), 2);
    logger.item(formatCommand('npm test'), 2);
    logger.newline();

  } catch (error) {
    logger.error(`Failed to initialize project: ${error}`);
    process.exit(1);
  }
}

async function copyFile(
  src: string,
  dest: string,
  replacements?: Record<string, string>
) {
  let content = await fs.readFile(src, "utf-8");

  if (replacements) {
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`{{${key}}}`, "g");
      content = content.replace(regex, value);
    }
  }
  await fs.writeFile(dest, content);
}

async function copyDir(src: string, dest: string, replacements?: Record<string, string>) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip template development files
    if (entry.name === 'types' || entry.name === '.vscode') {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, replacements);
    } else {
      // Apply replacements to text files
      if (replacements && (entry.name.endsWith('.toml') || entry.name.endsWith('.move'))) {
        await copyFile(srcPath, destPath, replacements);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
