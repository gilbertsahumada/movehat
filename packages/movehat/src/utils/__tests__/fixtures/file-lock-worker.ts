import { appendFileSync } from "node:fs";
import { withFileLock } from "../../fileLock.js";

const [key, eventFile, holdRaw, lockDir, signalMode] = process.argv.slice(2);
if (!key || !eventFile) throw new Error("expected key and event file");
const holdMs = Number(holdRaw ?? "100");
if (signalMode === "continue") {
  process.on("SIGINT", () => process.stdout.write("handled\n"));
}

await withFileLock(
  key,
  async () => {
    appendFileSync(
      eventFile,
      JSON.stringify({ event: "enter", pid: process.pid, at: Date.now() }) +
        "\n",
    );
    process.stdout.write("entered\n");
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    appendFileSync(
      eventFile,
      JSON.stringify({ event: "exit", pid: process.pid, at: Date.now() }) +
        "\n",
    );
  },
  { ...(lockDir ? { lockDir } : {}), pollMs: 5 },
);
