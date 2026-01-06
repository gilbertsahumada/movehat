import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import prompts from "prompts";
import { printMovehatBanner } from "../helpers/banner.js";
import { logger, createSpinnerChain, formatCommand } from "../ui/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
export default async function initCommand(projectName?: string) {
  // Show banner only on init command
  printMovehatBanner();

  // if name is not given
  if (!projectName) {
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

  const targetDir = projectName!;
  const projectPath = path.resolve(process.cwd(), targetDir);

  logger.newline();
  logger.info(`Initializing new Movehat project in ${projectPath}...`);
  logger.newline();

  try {
    const templatesDir = path.join(__dirname, "..", "templates");
    const steps = createSpinnerChain();

    // Step 1: Create project structure
    await steps.add('Creating project structure', async () => {
      await fs.mkdir(projectPath, { recursive: true });

      await copyFile(
        path.join(templatesDir, "package.json"),
        path.join(projectPath, "package.json"),
        { projectName: projectName! }
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
        { projectName: projectName! }
      );
    });

    // Step 2: Setup Move project
    await steps.add('Setting up Move project', async () => {
      await copyDir(
        path.join(templatesDir, "move"),
        path.join(projectPath, "move"),
        { projectName: projectName! }
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
    logger.item(formatCommand(`cd ${projectName}`), 2);
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
