import { basename } from "node:path";
import type {
  BinaryIdentity,
  EvidenceBundle,
  PrimitiveDraft,
  PrimitiveManifest,
  PrimitiveMethodDraft,
  Risk,
} from "./types.js";

interface MaterializeManifestInput {
  name: string;
  binary: BinaryIdentity;
  evidence: EvidenceBundle;
  learnedAt: string;
  draft: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPrimitiveDraft(value: unknown): asserts value is PrimitiveDraft {
  if (!isRecord(value)) throw new Error("Pi output must be a JSON object");
  nonEmptyString(value.description, "description");
  if (value.ask !== undefined) {
    if (!isRecord(value.ask)) throw new Error("ask must be an object");
    nonEmptyString(value.ask.method, "ask.method");
    nonEmptyString(value.ask.parameter, "ask.parameter");
  }
  if (!Array.isArray(value.methods) || value.methods.length === 0) {
    throw new Error("methods must be a non-empty array");
  }
  if (value.methods.length > 32) throw new Error("methods may contain at most 32 entries");

  const methodNames = new Set<string>();
  for (const [methodIndex, candidate] of value.methods.entries()) {
    if (!isRecord(candidate)) throw new Error(`methods[${methodIndex}] must be an object`);
    nonEmptyString(candidate.name, `methods[${methodIndex}].name`);
    if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(candidate.name)) {
      throw new Error(`Invalid method name: ${candidate.name}`);
    }
    if (methodNames.has(candidate.name)) {
      throw new Error(`Duplicate method name: ${candidate.name}`);
    }
    methodNames.add(candidate.name);
    nonEmptyString(candidate.description, `Method ${candidate.name} description`);
    if (!(["read", "write", "destructive"] as unknown[]).includes(candidate.risk)) {
      throw new Error(`Method ${candidate.name} risk must be read, write, or destructive`);
    }
    if (!(["text", "json", "jsonl"] as unknown[]).includes(candidate.output)) {
      throw new Error(`Method ${candidate.name} output must be text, json, or jsonl`);
    }
    nonEmptyString(candidate.evidenceId, `Method ${candidate.name} evidenceId`);
    if (!Array.isArray(candidate.argv) || candidate.argv.length > 16) {
      throw new Error(`Method ${candidate.name} argv must be an array of at most 16 strings`);
    }
    for (const token of candidate.argv) {
      if (
        typeof token !== "string" ||
        !token ||
        token.length > 256 ||
        /[\0\r\n]/.test(token)
      ) {
        throw new Error(`Method ${candidate.name} contains an invalid argv token`);
      }
    }
    if (!Array.isArray(candidate.parameters) || candidate.parameters.length > 32) {
      throw new Error(`Method ${candidate.name} parameters must be an array`);
    }
    const parameterNames = new Set<string>();
    const flags = new Set<string>();
    const positions = new Set<number>();
    for (const [parameterIndex, parameter] of candidate.parameters.entries()) {
      if (!isRecord(parameter)) {
        throw new Error(`Method ${candidate.name} parameter ${parameterIndex} must be an object`);
      }
      nonEmptyString(parameter.name, `Method ${candidate.name} parameter name`);
      if (!/^[a-z][a-z0-9_]*$/.test(parameter.name)) {
        throw new Error(`Invalid parameter name: ${parameter.name}`);
      }
      if (parameterNames.has(parameter.name)) {
        throw new Error(`Duplicate parameter name: ${parameter.name}`);
      }
      parameterNames.add(parameter.name);
      nonEmptyString(parameter.description, `Parameter ${parameter.name} description`);
      if (!(["string", "integer", "number", "boolean", "string[]"] as unknown[]).includes(parameter.type)) {
        throw new Error(`Parameter ${parameter.name} has an invalid type`);
      }
      if (typeof parameter.required !== "boolean") {
        throw new Error(`Parameter ${parameter.name} required must be boolean`);
      }
      if (parameter.kind === "positional") {
        if (!Number.isInteger(parameter.position) || (parameter.position as number) < 0) {
          throw new Error(`Parameter ${parameter.name} position must be a non-negative integer`);
        }
        if (positions.has(parameter.position as number)) {
          throw new Error(`Duplicate positional index: ${String(parameter.position)}`);
        }
        positions.add(parameter.position as number);
      } else if (parameter.kind === "option") {
        nonEmptyString(parameter.flag, `Parameter ${parameter.name} flag`);
        if (!/^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(parameter.flag)) {
          throw new Error(`Invalid option flag: ${parameter.flag}`);
        }
        if (flags.has(parameter.flag)) throw new Error(`Duplicate option flag: ${parameter.flag}`);
        if (candidate.argv.includes(parameter.flag)) {
          throw new Error(
            `Option flag ${parameter.flag} appears in both fixed argv and parameter ${parameter.name}`,
          );
        }
        flags.add(parameter.flag);
      } else {
        throw new Error(`Parameter ${parameter.name} kind must be positional or option`);
      }
    }
  }
}

function escalatedRisk(method: PrimitiveMethodDraft): Risk {
  const words = `${method.name} ${method.argv.join(" ")}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const destructive = new Set([
    "clear",
    "del",
    "delete",
    "destroy",
    "drop",
    "erase",
    "kill",
    "purge",
    "remove",
    "reset",
    "revoke",
    "rm",
    "terminate",
    "wipe",
  ]);
  if (words.some((word) => destructive.has(word))) return "destructive";
  if (method.risk !== "read") return method.risk;
  const write = new Set([
    "add",
    "apply",
    "commit",
    "create",
    "deploy",
    "disable",
    "edit",
    "enable",
    "install",
    "merge",
    "publish",
    "push",
    "restart",
    "send",
    "set",
    "start",
    "stop",
    "submit",
    "uninstall",
    "update",
    "upload",
    "write",
  ]);
  return words.some((word) => write.has(word)) ? "write" : "read";
}

export function materializeManifest(
  input: MaterializeManifestInput,
): PrimitiveManifest {
  assertPrimitiveDraft(input.draft);
  const methods = input.draft.methods.map((method) => {
    const evidence = input.evidence.probes.find(
      (candidate) => candidate.id === method.evidenceId,
    );
    if (!evidence) {
      throw new Error(`Method ${method.name} cites unknown evidence ${method.evidenceId}`);
    }

    const evidencePrefix = evidence.argv.filter(
      (token) => token !== "--help" && token !== "-h",
    );
    if (method.evidenceId === "root" && method.argv[0]) {
      const executableNames = new Set(
        [
          input.binary.requested,
          input.binary.path,
          input.evidence.requestedBinary,
          input.evidence.resolvedPath,
        ].flatMap((value) => {
          const filename = basename(value);
          return [filename, filename.replace(/\.[^.]+$/, "")];
        }),
      );
      if (executableNames.has(method.argv[0])) {
        throw new Error(
          `Root method ${method.name} must not include executable ${method.argv[0]} in argv`,
        );
      }
    }
    for (const [index, token] of evidencePrefix.entries()) {
      if (method.argv[index] !== token) {
        throw new Error(
          `Method ${method.name} does not match the command in ${method.evidenceId}`,
        );
      }
    }
    const helpText = `${evidence.stdout}\n${evidence.stderr}`;
    for (const token of method.argv.slice(evidencePrefix.length)) {
      if (!helpText.includes(token)) {
        const kind = token.startsWith("-") ? "Flag" : "Token";
        throw new Error(
          `${kind} ${token} is not present in ${method.evidenceId} help evidence`,
        );
      }
    }
    for (const parameter of method.parameters) {
      if (
        parameter.kind === "option" &&
        !helpText.includes(parameter.flag)
      ) {
        throw new Error(
          `Flag ${parameter.flag} is not present in ${method.evidenceId} help evidence`,
        );
      }
    }

    return {
      ...method,
      risk: escalatedRisk(method),
      probe: {
        argv: [...evidence.argv],
        expectExit: evidence.exitCode === null ? [0] : [evidence.exitCode],
      },
    };
  });

  const ask = input.draft.ask;
  if (ask) {
    const method = methods.find((candidate) => candidate.name === ask.method);
    if (!method) {
      throw new Error(`Question entrypoint cites unknown method: ${ask.method}`);
    }
    if (method.risk !== "read") {
      throw new Error("Question entrypoint method must be read-only");
    }
    const parameter = method.parameters.find(
      (candidate) => candidate.name === ask.parameter,
    );
    if (!parameter) {
      throw new Error(
        `Question entrypoint cites unknown parameter: ${ask.method}.${ask.parameter}`,
      );
    }
    if (
      parameter.kind !== "positional" ||
      (parameter.type !== "string" && parameter.type !== "string[]") ||
      !parameter.required
    ) {
      throw new Error(
        "Question entrypoint parameter must be a required positional string or string[]",
      );
    }
    if (method.parameters.length !== 1) {
      throw new Error(
        "Question entrypoint method must have exactly one parameter",
      );
    }
  }

  return {
    schemaVersion: 1,
    name: input.name,
    description: input.draft.description,
    binary: input.binary,
    learnedAt: input.learnedAt,
    engine: {
      kind: "pi",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      thinking: "high",
    },
    ...(ask ? { ask } : {}),
    methods,
  };
}
