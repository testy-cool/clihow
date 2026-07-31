import { assertBinaryUnchanged } from "./binary.js";
import { runProcess } from "./process.js";
import type {
  MethodParameter,
  PrimitiveManifest,
  PrimitiveMethod,
  Risk,
} from "./types.js";

export type MethodArguments = Record<string, unknown>;

export interface ExecuteMethodOptions {
  dryRun?: boolean;
  timeoutMs?: number;
  yes?: boolean;
}

export interface InvocationResult {
  primitive: string;
  method: string;
  risk: Risk;
  command: string;
  argv: string[];
  executed: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

function valueFor(
  parameter: MethodParameter,
  args: MethodArguments,
): unknown {
  const supplied = args[parameter.name];
  const value = supplied === undefined ? parameter.default : supplied;
  if (value === undefined && parameter.required) {
    throw new Error(`Missing required argument: ${parameter.name}`);
  }
  return value;
}

function encodedValues(parameter: MethodParameter, value: unknown): string[] {
  if (parameter.type === "string") {
    if (typeof value !== "string") {
      throw new Error(`Argument ${parameter.name} must be a string`);
    }
    return [value];
  }
  if (parameter.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`Argument ${parameter.name} must be an integer`);
    }
    return [String(value)];
  }
  if (parameter.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Argument ${parameter.name} must be a finite number`);
    }
    return [String(value)];
  }
  if (parameter.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error(`Argument ${parameter.name} must be a boolean`);
    }
    return [String(value)];
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error(`Argument ${parameter.name} must be an array of strings`);
  }
  return value;
}

export function buildMethodArgv(
  method: PrimitiveMethod,
  args: MethodArguments,
): string[] {
  const knownArguments = new Set(
    method.parameters.map((parameter) => parameter.name),
  );
  for (const name of Object.keys(args)) {
    if (!knownArguments.has(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
  }

  const argv = [...method.argv];
  const positionals = method.parameters
    .filter((parameter) => parameter.kind === "positional")
    .sort((left, right) => left.position - right.position);
  const options = method.parameters.filter(
    (parameter) => parameter.kind === "option",
  );

  for (const parameter of positionals) {
    const value = valueFor(parameter, args);
    if (value === undefined) continue;
    argv.push(...encodedValues(parameter, value));
  }

  for (const parameter of options) {
    const value = valueFor(parameter, args);
    if (value === undefined || value === false) continue;
    if (parameter.type === "boolean") {
      if (value !== true) {
        throw new Error(`Argument ${parameter.name} must be a boolean`);
      }
      argv.push(parameter.flag);
      continue;
    }
    for (const encoded of encodedValues(parameter, value)) {
      argv.push(parameter.flag, encoded);
    }
  }

  return argv;
}

export async function executeMethod(
  manifest: PrimitiveManifest,
  methodName: string,
  args: MethodArguments,
  options: ExecuteMethodOptions = {},
): Promise<InvocationResult> {
  const method = manifest.methods.find((candidate) => candidate.name === methodName);
  if (!method) throw new Error(`Unknown method: ${manifest.name}.${methodName}`);
  const argv = buildMethodArgv(method, args);
  await assertBinaryUnchanged(manifest.binary, manifest.name);
  if (!options.dryRun && method.risk !== "read" && !options.yes) {
    throw new Error(
      `Method ${manifest.name}.${method.name} is ${method.risk}; pass --yes to execute it`,
    );
  }
  if (options.dryRun) {
    return {
      primitive: manifest.name,
      method: method.name,
      risk: method.risk,
      command: manifest.binary.path,
      argv,
      executed: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      durationMs: 0,
      timedOut: false,
      truncated: false,
    };
  }

  const result = await runProcess(manifest.binary.path, argv, {
    maxOutputBytes: 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  return {
    primitive: manifest.name,
    method: method.name,
    risk: method.risk,
    command: manifest.binary.path,
    argv,
    executed: true,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    truncated: result.truncated,
  };
}
