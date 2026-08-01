import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "./process.js";

export const PI_ENGINE = {
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  thinking: "high",
} as const;

export interface PiCompileOptions {
  piBinary?: string;
  timeoutMs?: number;
  traceDirectory?: string;
}

async function writeTrace(
  directory: string,
  createdAt: string,
  prompt: string,
  result: Awaited<ReturnType<typeof runProcess>>,
): Promise<void> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const timestamp = createdAt.replaceAll(":", "-");
  const path = join(root, `${timestamp}-${randomUUID()}.json`);
  await writeFile(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        createdAt,
        engine: PI_ENGINE,
        prompt,
        response: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        signal: result.signal,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        truncated: result.truncated,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
}

export async function compileWithPi(
  prompt: string,
  options: PiCompileOptions = {},
): Promise<string> {
  const createdAt = new Date().toISOString();
  if (options.traceDirectory) {
    await mkdir(resolve(options.traceDirectory), { recursive: true, mode: 0o700 });
  }
  const argv = [
    "--provider",
    PI_ENGINE.provider,
    "--model",
    PI_ENGINE.model,
    "--thinking",
    PI_ENGINE.thinking,
    "--print",
    "--no-session",
    "--no-tools",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    prompt,
  ];
  const result = await runProcess(options.piBinary ?? "pi", argv, {
    maxOutputBytes: 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 180_000,
  });
  if (options.traceDirectory) {
    await writeTrace(options.traceDirectory, createdAt, prompt, result);
  }
  if (result.timedOut) {
    throw new Error(`Pi timed out after ${String(options.timeoutMs ?? 180_000)}ms`);
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "no output";
    throw new Error(`Pi exited with ${String(result.exitCode)}: ${detail}`);
  }
  if (!result.stdout.trim()) throw new Error("Pi returned no output");
  return result.stdout;
}
