import { join } from "path";
import { existsSync } from "fs";
import prompts from "prompts";
import { runMoveTests } from "../helpers/move-tests.js";
import { logger, colors, symbols } from "../ui/index.js";
import { runCli } from "../utils/runCli.js";

interface TestOptions {
  move?: boolean;
  ts?: boolean;
  all?: boolean;
  watch?: boolean;
  filter?: string;
  // Legacy flags (for backward compatibility)
  moveOnly?: boolean;
  tsOnly?: boolean;
}

type TestType = "move" | "ts" | "all";

export default async function testCommand(options: TestOptions = {}) {
  // Handle legacy flags
  if (options.moveOnly) options.move = true;
  if (options.tsOnly) options.ts = true;

  // Determine test type from flags
  let testType: TestType | undefined;

  if (options.all) {
    testType = "all";
  } else if (options.move && options.ts) {
    testType = "all";
  } else if (options.move) {
    testType = "move";
  } else if (options.ts) {
    testType = "ts";
  }

  // If no flags provided, show interactive menu
  if (!testType) {
    testType = await showTestMenu();
    if (!testType) {
      // User cancelled
      process.exit(0);
    }
  }

  // Execute based on test type
  switch (testType) {
    case "move":
      await runMoveTestsOnly(options.filter);
      break;
    case "ts":
      await runTypeScriptTestsOnly(options.watch);
      break;
    case "all":
      await runAllTests(options.filter);
      break;
  }
}

/**
 * Show interactive menu to select test type
 */
async function showTestMenu(): Promise<TestType | undefined> {
  logger.newline();

  const response = await prompts({
    type: "select",
    name: "testType",
    message: "What tests do you want to run?",
    choices: [
      {
        title: `${colors.success("Move unit tests")} ${colors.muted("(fast, no node required)")}`,
        value: "move",
        description: "Run #[test] functions in your Move contracts",
      },
      {
        title: `${colors.info("TypeScript integration tests")} ${colors.muted("(starts local node)")}`,
        value: "ts",
        description: "Run .test.ts files with a local Movement node",
      },
      {
        title: `${colors.brand("All tests")} ${colors.muted("(Move + TypeScript)")}`,
        value: "all",
        description: "Run both Move and TypeScript tests sequentially",
      },
    ],
    initial: 0,
  });

  return response.testType;
}

/**
 * Run only Move unit tests
 */
async function runMoveTestsOnly(filter?: string): Promise<void> {
  logger.newline();
  logger.phase("Move Unit Tests");
  logger.newline();

  try {
    await runMoveTests({
      filter,
      skipIfMissing: false, // Fail if no Move directory
    });
  } catch (error) {
    logger.newline();
    logger.error("Move tests failed");
    process.exit(1);
  }
}

/**
 * Run only TypeScript integration tests
 */
async function runTypeScriptTestsOnly(watch: boolean = false): Promise<void> {
  logger.newline();
  logger.phase("TypeScript Integration Tests");

  if (!watch) {
    logger.newline();
    logger.info("This will start a local Movement node for testing");
    logger.newline();
  }

  try {
    await runTypeScriptTests(watch);
    if (!watch) {
      logger.newline();
      logger.success("TypeScript tests passed");
    }
  } catch (error) {
    logger.newline();
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exit(1);
  }
}

/**
 * Run all tests (Move + TypeScript)
 */
async function runAllTests(filter?: string): Promise<void> {
  logger.newline();
  logger.phase("Running All Tests");

  // Section 1: Move Tests
  logger.newline();
  logger.phase("1. Move Unit Tests");
  logger.newline();

  try {
    await runMoveTests({
      filter,
      skipIfMissing: true, // Gracefully skip if no Move directory
    });
  } catch (error) {
    logger.newline();
    logger.error("Move tests failed");
    logger.divider();
    process.exit(1);
  }

  // Section 2: TypeScript Tests
  logger.newline();
  logger.phase("2. TypeScript Integration Tests");
  logger.newline();

  try {
    await runTypeScriptTests(false);
    logger.newline();
    logger.divider();
    logger.newline();
    logger.success("All tests passed!");
    logger.newline();
  } catch (error) {
    logger.newline();
    logger.divider();
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exit(1);
  }
}

/**
 * Run TypeScript tests using Mocha
 */
async function runTypeScriptTests(watch: boolean = false): Promise<void> {
  const testDir = join(process.cwd(), "tests");

  if (!existsSync(testDir)) {
    logger.plain(`${colors.muted(symbols.info)} No TypeScript tests found ${colors.muted("(tests/ directory not found)")}`);
    logger.plain(`   ${colors.muted("Skipping TypeScript tests...")}`);
    logger.newline();
    return;
  }

  const mochaPath = join(process.cwd(), "node_modules", ".bin", "mocha");

  if (!existsSync(mochaPath)) {
    logger.error("Mocha not found in project dependencies");
    logger.plain(`   ${colors.muted("Install it with:")} ${colors.info("npm install --save-dev mocha")}`);
    throw new Error("Mocha not found");
  }

  const args = watch ? ["--watch"] : [];

  // Watch mode: Mocha never exits. We fire-and-forget runCli so it owns the
  // terminal until the user Ctrl+Cs the parent (which kills the child via
  // inherited stdio). Attach .catch so a spawn-time failure doesn't become
  // an unhandled rejection.
  /* c8 ignore start -- watch mode launches a long-running mocha process and
     never returns; not testable as a unit. Behaviour is covered by the
     integration suite and by manual smoke. */
  if (watch) {
    runCli(
      {
        command: mochaPath,
        args,
        env: { ...process.env },
        inheritStdio: true,
      },
      { throwOnNonZeroExit: false }
    ).catch((error) => {
      logger.error(`Mocha watch crashed: ${(error as Error).message}`);
      process.exit(1);
    });

    logger.plain(`${colors.info(symbols.info)} Watch mode active. Press Ctrl+C to exit.`);
    logger.newline();
    return;
  }
  /* c8 ignore stop */

  // Non-watch mode: await the run, surface the exit code as a thrown error
  // so the orchestrator above can summarize the failure.
  let result;
  try {
    result = await runCli(
      {
        command: mochaPath,
        args,
        env: { ...process.env },
        inheritStdio: true,
      },
      { throwOnNonZeroExit: false }
    );
    /* c8 ignore start -- runCli with throwOnNonZeroExit:false only throws on
       spawn-time failure (ENOENT, etc.), which is blocked upstream by the
       existsSync(mochaPath) check at line 192. Defense in depth. */
  } catch (error) {
    logger.error(`Failed to run TypeScript tests: ${(error as Error).message}`);
    throw error;
  }
  /* c8 ignore stop */

  if (result.exitCode === 0) {
    return;
  }
  throw new Error(`TypeScript tests failed with exit code ${result.exitCode}`);
}
