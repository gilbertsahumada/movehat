import { logger } from "../ui/index.js";
import { runMovementMoveCommand } from "./move-tool.js";

export default async function proveCommand(): Promise<void> {
  logger.step("Running Move Prover...");
  await runMovementMoveCommand("prove");
}
