import { runProcess } from "./process.js";

export async function browseThreads(argv: string[]): Promise<number> {
  let result;
  try {
    result = await runProcess("agentconvos", argv, {
      stdio: "inherit",
      timeoutMs: 24 * 60 * 60_000,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("agentconvos is unavailable; use clihow threads --json");
    }
    throw error;
  }
  return result.exitCode ?? 1;
}
