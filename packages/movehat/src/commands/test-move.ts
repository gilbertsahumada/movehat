import { runMoveTests } from "../helpers/move-tests.js";
import { logger } from "../ui/index.js";

interface TestMoveOptions {
  filter?: string;
  ignoreWarnings?: boolean;
}

export default async function testMoveCommand(options: TestMoveOptions = {}) {
  try {
    logger.step("Running Move unit tests...");
    logger.newline();

    await runMoveTests({
      filter: options.filter,
      ignoreWarnings: options.ignoreWarnings,
      skipIfMissing: false, // Fail if no Move directory (standalone command mode)
    });

    process.exit(0);
  } catch (err) {
    logger.newline();
    logger.error("Move tests failed");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg) {
      logger.error(`   ${msg}`);
    }
    process.exit(1);
  }
}
