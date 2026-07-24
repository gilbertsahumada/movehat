import { logger } from "../ui/index.js";
import { runMovementMoveCommand } from "./move-tool.js";

const MOVE_COVERAGE_TEST_TIMEOUT_MS = 30 * 60 * 1000;

export default async function coverageCommand(filter?: string): Promise<void> {
  logger.step("Running Move tests with coverage...");
  const testArgs = ["--dev", "--coverage"];
  if (filter) testArgs.push("--filter", filter);
  await runMovementMoveCommand("test", {
    args: testArgs,
    timeoutMs: MOVE_COVERAGE_TEST_TIMEOUT_MS,
  });

  logger.step("Move coverage summary");
  await runMovementMoveCommand("coverage", { verbArgs: ["summary"] });
}
