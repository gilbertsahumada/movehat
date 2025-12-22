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
  } catch (err: any) {
    console.error("\n✗ Move tests failed");
    if (err.message) {
      console.error(`   ${err.message}`);
    }
    process.exit(1);
  }
}
