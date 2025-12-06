//import { exec } from "child_process";
//import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

//const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function initCommand(projectName?: string) {
  const targetDir = projectName || ".";
  const projectPath = path.resolve(process.cwd(), targetDir);

  console.log(`Initializing new Movehat project in ${projectPath}...`);

  try {
    if (projectName) {
      await fs.mkdir(projectPath, { recursive: true });
    }

    const templatesDir = path.join(__dirname, "..", "templates");

    console.log("📁 Creating project structure...");

    await copyFile(
      path.join(templatesDir, "package.json"),
      path.join(projectPath, "package.json"),
      { projectName: projectName || "my-move-project" }
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
      path.join(templatesDir, ".gitignore"),
      path.join(projectPath, ".gitignore")
    );

    await copyFile(
      path.join(templatesDir, "README.md"),
      path.join(projectPath, "README.md"),
      { projectName: projectName || "my-move-project" }
    );

    // 3. Copiar carpeta move/
    console.log("📦 Setting up Move project...");
    await copyDir(
      path.join(templatesDir, "move"),
      path.join(projectPath, "move")
    );

    // 4. Copiar scripts/
    console.log("📜 Adding deployment scripts...");
    await copyDir(
      path.join(templatesDir, "scripts"),
      path.join(projectPath, "scripts")
    );

    // 5. Copiar tests/
    console.log("🧪 Adding test files...");
    await copyDir(
      path.join(templatesDir, "tests"),
      path.join(projectPath, "tests")
    );

    console.log("\n✅ Project created successfully!\n");
    console.log("📝 Next steps:\n");
    if (projectName) {
      console.log(`   cd ${projectName}`);
    }
    console.log(`   cp .env.example .env`);
    console.log(`   # Edit .env with your credentials`);
    console.log(`   npm install`);
    console.log(`   npx movehat compile`);
    console.log(`   npm test\n`);
  } catch (error) {
    console.error(`Failed to initialize project: ${error}`);
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

async function copyDir(src: string, dest: string) {
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
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
