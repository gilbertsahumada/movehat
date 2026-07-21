import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { __setFileLockTestHooks, withFileLock } from "../../fileLock.js";

const [key, eventFile, holdRaw, lockDir, signalMode, label = "worker", releaseFile] = process.argv.slice(2);
if (!key || !eventFile) throw new Error("expected key and event file");
const holdMs = Number(holdRaw ?? "100");
if (signalMode === "continue") {
  process.on("SIGINT", () => process.stdout.write("handled\n"));
}
const waitForFile = async (path: string): Promise<void> => {
  while (!existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 5));
};
if (signalMode === "pause-reclaimer") {
  __setFileLockTestHooks({
    afterDeadOwnerObserved: async () => {
      writeFileSync(`${eventFile}.observed`, "ready");
      await waitForFile(`${eventFile}.resume-observed`);
    },
    afterIntentPublished: async () => {
      writeFileSync(`${eventFile}.intent`, "ready");
      await waitForFile(`${eventFile}.resume-intent`);
    },
  });
}

await withFileLock(
  key,
  async () => {
    appendFileSync(
      eventFile,
      JSON.stringify({ event: "enter", label, pid: process.pid, at: Date.now() }) +
        "\n",
    );
    process.stdout.write("entered\n");
    if (releaseFile) await waitForFile(releaseFile);
    else await new Promise((resolve) => setTimeout(resolve, holdMs));
    appendFileSync(
      eventFile,
      JSON.stringify({ event: "exit", label, pid: process.pid, at: Date.now() }) +
        "\n",
    );
  },
  { ...(lockDir ? { lockDir } : {}), pollMs: 5 },
);
