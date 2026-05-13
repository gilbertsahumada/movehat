import { runMoveTests } from "../helpers/move-tests.js";

interface TestMoveOptions {
  filter?: string;
  ignoreWarnings?: boolean;
}

export default async function testMoveCommand(options: TestMoveOptions = {}) {
  try {
    console.log("Running Move unit tests...\n");

    await runMoveTests({
      filter: options.filter,
      ignoreWarnings: options.ignoreWarnings,
      skipIfMissing: false, // Fail if no Move directory (standalone command mode)
    });

    process.exit(0);
  } catch (err) {
    console.error("\n✗ Move tests failed");
    const msg = err instanceof Error ? err.message : String(err);
    if (msg) {
      console.error(`   ${msg}`);
    }
    process.exit(1);
  }
}
