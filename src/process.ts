import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface ProcessResult {
  command: string;
  argv: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  stdio?: "capture" | "inherit";
  timeoutMs?: number;
}

export async function runProcess(
  command: string,
  argv: string[],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const startedAt = performance.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
  const inheritStdio = options.stdio === "inherit";

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: options.cwd,
      detached: !inheritStdio && process.platform !== "win32",
      env: options.env,
      shell: false,
      stdio: inheritStdio
        ? ["inherit", "inherit", "inherit"]
        : ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let truncated = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Fall through when the process exited between the timer and signal.
        }
      }
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, maxOutputBytes - stdoutBytes);
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        stdout.push(kept);
        stdoutBytes += kept.length;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const remaining = Math.max(0, maxOutputBytes - stderrBytes);
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        stderr.push(kept);
        stderrBytes += kept.length;
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        command,
        argv: [...argv],
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
        truncated,
      });
    });
  });
}
