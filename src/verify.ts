import { assertBinaryUnchanged } from "./binary.js";
import { runProcess } from "./process.js";
import type { PrimitiveManifest } from "./types.js";

export interface TestPrimitiveOptions {
  now?: () => Date;
  timeoutMs?: number;
}

export interface MethodVerification {
  method: string;
  argv: string[];
  expectedExit: number[];
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
  passed: boolean;
  stderr: string;
}

export interface PrimitiveVerification {
  primitive: string;
  testedAt: string;
  passed: boolean;
  methods: MethodVerification[];
}

export async function testPrimitive(
  manifest: PrimitiveManifest,
  options: TestPrimitiveOptions = {},
): Promise<PrimitiveVerification> {
  await assertBinaryUnchanged(manifest.binary, manifest.name);
  const methods: MethodVerification[] = [];
  for (const method of manifest.methods) {
    const finalToken = method.probe.argv.at(-1);
    if (finalToken !== "--help" && finalToken !== "-h") {
      throw new Error(`Refusing unsafe verification probe for ${method.name}`);
    }
    const result = await runProcess(manifest.binary.path, method.probe.argv, {
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      maxOutputBytes: 256 * 1024,
      timeoutMs: options.timeoutMs ?? 10_000,
    });
    const passed =
      !result.timedOut && method.probe.expectExit.includes(result.exitCode ?? -1);
    methods.push({
      method: method.name,
      argv: [...method.probe.argv],
      expectedExit: [...method.probe.expectExit],
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      truncated: result.truncated,
      durationMs: result.durationMs,
      passed,
      stderr: result.stderr,
    });
  }
  return {
    primitive: manifest.name,
    testedAt: (options.now ?? (() => new Date()))().toISOString(),
    passed: methods.every((method) => method.passed),
    methods,
  };
}
