import { logger } from "../ui/index.js";
import { runMovementMoveCommand } from "./move-tool.js";

export default async function lintCommand(): Promise<void> {
  logger.step("Linting Move contracts...");
  await runMovementMoveCommand("lint", { args: ["--dev"] });
}
