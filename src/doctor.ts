import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PI_ENGINE } from "./pi.js";
import { runProcess } from "./process.js";

export interface DoctorOptions {
  piBinary?: string;
  registryRoot: string;
}

export interface DoctorCheck {
  name: "pi" | "model" | "registry";
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const piBinary = options.piBinary ?? "pi";
  try {
    const result = await runProcess(piBinary, ["--version"], {
      timeoutMs: 10_000,
    });
    checks.push({
      name: "pi",
      ok: result.exitCode === 0 && !result.timedOut,
      detail:
        result.stdout.trim() || result.stderr.trim() || `exit ${String(result.exitCode)}`,
    });
  } catch (error) {
    checks.push({ name: "pi", ok: false, detail: (error as Error).message });
  }

  try {
    const result = await runProcess(
      piBinary,
      ["--list-models", PI_ENGINE.provider],
      { timeoutMs: 20_000, maxOutputBytes: 256 * 1024 },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    const available =
      result.exitCode === 0 &&
      output.includes(PI_ENGINE.provider) &&
      output.includes(PI_ENGINE.model);
    checks.push({
      name: "model",
      ok: available,
      detail: available
        ? `${PI_ENGINE.provider}/${PI_ENGINE.model} (${PI_ENGINE.thinking})`
        : `${PI_ENGINE.provider}/${PI_ENGINE.model} is unavailable`,
    });
  } catch (error) {
    checks.push({ name: "model", ok: false, detail: (error as Error).message });
  }

  const probePath = join(options.registryRoot, `.doctor-${randomUUID()}`);
  try {
    await mkdir(options.registryRoot, { recursive: true });
    await writeFile(probePath, "ok\n", { encoding: "utf8", mode: 0o600 });
    await unlink(probePath);
    checks.push({
      name: "registry",
      ok: true,
      detail: options.registryRoot,
    });
  } catch (error) {
    checks.push({
      name: "registry",
      ok: false,
      detail: (error as Error).message,
    });
  }

  return { ok: checks.every((check) => check.ok), checks };
}
