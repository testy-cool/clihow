import type { MethodParameter, PrimitiveMethod } from "./types.js";

export type MethodArguments = Record<string, unknown>;

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
