#!/usr/bin/env node

import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { answerQuestion, type RegistryPrimitive } from "./answer.js";
import { runDoctor } from "./doctor.js";
import { executeMethod, type MethodArguments } from "./invoke.js";
import { learnPrimitive } from "./learner.js";
import { compileWithPi } from "./pi.js";
import {
  listPrimitives,
  loadEvidence,
  loadPrimitive,
  registryHome,
  savePrimitive,
} from "./registry.js";
import { selectMethod } from "./selector.js";
import type { PrimitiveManifest } from "./types.js";
import { testPrimitive } from "./verify.js";

export const VERSION = "0.1.0";

export interface CliIo {
  env: NodeJS.ProcessEnv;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  compileAnswer?: (prompt: string) => Promise<string>;
}

const defaultIo: CliIo = {
  env: process.env,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

interface ParsedArguments {
  positionals: string[];
  options: Record<string, string | boolean>;
}

function parseArguments(
  args: string[],
  valueOptions: string[] = [],
  booleanOptions: string[] = [],
): ParsedArguments {
  const values = new Set(valueOptions);
  const booleans = new Set(booleanOptions);
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (token === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equalIndex = token.indexOf("=");
    const name = equalIndex === -1 ? token : token.slice(0, equalIndex);
    if (booleans.has(name)) {
      if (equalIndex !== -1) throw new Error(`${name} does not take a value`);
      options[name] = true;
      continue;
    }
    if (!values.has(name)) throw new Error(`Unknown option: ${name}`);
    const value = equalIndex === -1 ? args[index + 1] : token.slice(equalIndex + 1);
    if (value === undefined || (equalIndex === -1 && value.startsWith("--"))) {
      throw new Error(`${name} requires a value`);
    }
    options[name] = value;
    if (equalIndex === -1) index += 1;
  }
  return { positionals, options };
}

function optionString(parsed: ParsedArguments, name: string): string | undefined {
  const value = parsed.options[name];
  return typeof value === "string" ? value : undefined;
}

function optionBoolean(parsed: ParsedArguments, name: string): boolean {
  return parsed.options[name] === true;
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function deriveName(binary: string): string {
  const name = basename(binary)
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(`Cannot derive a primitive name from ${binary}; pass --name`);
  }
  return name;
}

function parseTarget(target: string): { primitive: string; method?: string } {
  const separator = target.indexOf(".");
  if (separator === -1) return { primitive: target };
  const primitive = target.slice(0, separator);
  const method = target.slice(separator + 1);
  if (!primitive || !method) throw new Error(`Invalid target: ${target}`);
  return { primitive, method };
}

function parseMethodArguments(value: string | undefined): MethodArguments {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--args-json must contain a JSON object");
  }
  return parsed as MethodArguments;
}

function rootHelp(primitives?: PrimitiveManifest[]): string {
  const learned =
    primitives === undefined
      ? "  Unavailable."
      : primitives.length === 0
        ? "  None yet."
        : primitives
            .map(
              (primitive) =>
                `  ${primitive.name}\t${String(primitive.methods.length)} ${primitive.methods.length === 1 ? "method" : "methods"}`,
            )
            .join("\n");
  return `cmdmint ${VERSION} - mint installed CLIs into tested primitives

Usage:
  cmdmint help <primitive> [--json]
  cmdmint learn <binary> [--name <name>] [--json]
  cmdmint list [--json]
  cmdmint describe <primitive>[.<method>] [--json]
  cmdmint test <primitive> [--json]
  cmdmint call <primitive>.<method> [--args-json <json>] [--dry-run] [--yes] [--json]
  cmdmint use <primitive> <intent> [--dry-run] [--yes] [--json]
  cmdmint ask <question> [--json]
  cmdmint ask <primitive> <question> [--json]
  cmdmint doctor [--json]

Learned primitives:
${learned}

Runtime:
  Learning, natural-language selection, and grounded Q&A use Pi with
  openai-codex/gpt-5.6-luna at High thinking. Learned methods execute
  deterministically without a shell. Write and destructive methods require --yes.

Environment:
  CMDMINT_HOME       Registry directory (default: ~/.local/share/cmdmint)
  CMDMINT_PI_BINARY  Pi executable override for testing or custom installs
`;
}

function primitiveHelpValue(manifest: PrimitiveManifest) {
  return {
    name: manifest.name,
    description: manifest.description,
    methodCount: manifest.methods.length,
    binary: {
      requested: manifest.binary.requested,
      path: manifest.binary.path,
      version: manifest.binary.version,
    },
    learnedAt: manifest.learnedAt,
    methods: manifest.methods.map((method) => ({
      name: method.name,
      description: method.description,
      risk: method.risk,
      output: method.output,
      parameters: method.parameters,
      evidenceId: method.evidenceId,
      call: `cmdmint call ${manifest.name}.${method.name}`,
    })),
  };
}

function primitiveHelp(manifest: PrimitiveManifest): string {
  const lines = [
    `${manifest.name} - ${manifest.description}`,
    `Binary: ${manifest.binary.requested} (${manifest.binary.version})`,
    "",
    "Methods:",
  ];
  for (const method of manifest.methods) {
    lines.push(`  ${method.name}  [${method.risk}, ${method.output}]  ${method.description}`);
    for (const parameter of method.parameters) {
      const label =
        parameter.kind === "option"
          ? `${parameter.name} (${parameter.flag})`
          : parameter.name;
      lines.push(
        `    ${label}  ${parameter.type}  ${parameter.required ? "required" : "optional"}  ${parameter.description}`,
      );
    }
    lines.push(`    cmdmint call ${manifest.name}.${method.name} --args-json '<json>'`);
  }
  if (manifest.methods.length === 0) lines.push("  No methods learned.");
  return `${lines.join("\n")}\n`;
}

async function loadRegistryRecords(
  root: string,
  manifests: PrimitiveManifest[],
): Promise<RegistryPrimitive[]> {
  return await Promise.all(
    manifests.map(async (manifest) => ({
      manifest,
      evidence: await loadEvidence(root, manifest.name),
    })),
  );
}

async function dispatch(args: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  const root = registryHome(io.env);
  if (!command || command === "--help" || command === "-h") {
    let primitives: PrimitiveManifest[] | undefined;
    try {
      primitives = await listPrimitives(root);
    } catch {
      // Root help must stay usable even when the registry is unreadable.
    }
    io.stdout(rootHelp(primitives));
    return 0;
  }
  if (command === "--version" || command === "version") {
    io.stdout(`${VERSION}\n`);
    return 0;
  }

  const piBinary = io.env.CMDMINT_PI_BINARY;

  if (command === "help") {
    const parsed = parseArguments(rest, [], ["--json"]);
    const name = parsed.positionals[0];
    if (!name) {
      if (parsed.positionals.length) throw new Error("Usage: cmdmint help <primitive> [--json]");
      let primitives: PrimitiveManifest[] | undefined;
      try {
        primitives = await listPrimitives(root);
      } catch {
        // Root help must stay usable even when the registry is unreadable.
      }
      io.stdout(rootHelp(primitives));
      return 0;
    }
    if (parsed.positionals.length !== 1) {
      throw new Error("Usage: cmdmint help <primitive> [--json]");
    }
    const manifest = await loadPrimitive(root, name);
    if (optionBoolean(parsed, "--json")) writeJson(io, primitiveHelpValue(manifest));
    else io.stdout(primitiveHelp(manifest));
    return 0;
  }

  if (command === "learn") {
    const parsed = parseArguments(rest, ["--name", "--max-subcommands"], ["--json"]);
    const binary = parsed.positionals[0];
    if (!binary || parsed.positionals.length !== 1) {
      throw new Error("Usage: cmdmint learn <binary> [--name <name>] [--json]");
    }
    const maxSubcommandsValue = optionString(parsed, "--max-subcommands");
    const maxSubcommands = maxSubcommandsValue
      ? Number.parseInt(maxSubcommandsValue, 10)
      : undefined;
    if (maxSubcommands !== undefined && (!Number.isInteger(maxSubcommands) || maxSubcommands < 1)) {
      throw new Error("--max-subcommands must be a positive integer");
    }
    const learnOptions = {
      binary,
      name: optionString(parsed, "--name") ?? deriveName(binary),
      ...(maxSubcommands === undefined ? {} : { maxSubcommands }),
      ...(piBinary ? { piBinary } : {}),
    };
    const result = await learnPrimitive(learnOptions);
    const verification = await testPrimitive(result.manifest);
    if (!verification.passed) {
      throw new Error("Generated primitive failed its help verification probes");
    }
    await savePrimitive(root, result.manifest, result.evidence);
    if (optionBoolean(parsed, "--json")) {
      writeJson(io, { ...result, verification });
    } else {
      io.stdout(
        `Minted ${result.manifest.name}: ${String(result.manifest.methods.length)} methods, ${String(verification.methods.length)} probes passed\n`,
      );
    }
    return 0;
  }

  if (command === "list") {
    const parsed = parseArguments(rest, [], ["--json"]);
    if (parsed.positionals.length) throw new Error("Usage: cmdmint list [--json]");
    const manifests = await listPrimitives(root);
    const summaries = manifests.map((manifest) => ({
      name: manifest.name,
      description: manifest.description,
      methods: manifest.methods.map((method) => method.name),
      binary: manifest.binary.path,
      learnedAt: manifest.learnedAt,
    }));
    if (optionBoolean(parsed, "--json")) writeJson(io, summaries);
    else if (summaries.length === 0) io.stdout("No primitives learned yet.\n");
    else {
      for (const summary of summaries) {
        io.stdout(`${summary.name}\t${String(summary.methods.length)} methods\t${summary.description}\n`);
      }
    }
    return 0;
  }

  if (command === "describe") {
    const parsed = parseArguments(rest, [], ["--json"]);
    const targetValue = parsed.positionals[0];
    if (!targetValue || parsed.positionals.length !== 1) {
      throw new Error("Usage: cmdmint describe <primitive>[.<method>] [--json]");
    }
    const target = parseTarget(targetValue);
    const manifest = await loadPrimitive(root, target.primitive);
    const value = target.method
      ? manifest.methods.find((method) => method.name === target.method)
      : manifest;
    if (!value) throw new Error(`Unknown method: ${targetValue}`);
    writeJson(io, value);
    return 0;
  }

  if (command === "test") {
    const parsed = parseArguments(rest, [], ["--json"]);
    const name = parsed.positionals[0];
    if (!name || parsed.positionals.length !== 1) {
      throw new Error("Usage: cmdmint test <primitive> [--json]");
    }
    const report = await testPrimitive(await loadPrimitive(root, name));
    if (optionBoolean(parsed, "--json")) writeJson(io, report);
    else {
      io.stdout(
        `${report.passed ? "PASS" : "FAIL"} ${name}: ${String(report.methods.filter((method) => method.passed).length)}/${String(report.methods.length)} probes\n`,
      );
    }
    return report.passed ? 0 : 1;
  }

  if (command === "call") {
    const parsed = parseArguments(rest, ["--args-json"], ["--dry-run", "--yes", "--json"]);
    const targetValue = parsed.positionals[0];
    if (!targetValue || parsed.positionals.length !== 1) {
      throw new Error("Usage: cmdmint call <primitive>.<method> [--args-json <json>]");
    }
    const target = parseTarget(targetValue);
    if (!target.method) throw new Error("call requires <primitive>.<method>");
    const result = await executeMethod(
      await loadPrimitive(root, target.primitive),
      target.method,
      parseMethodArguments(optionString(parsed, "--args-json")),
      {
        dryRun: optionBoolean(parsed, "--dry-run"),
        yes: optionBoolean(parsed, "--yes"),
      },
    );
    if (optionBoolean(parsed, "--json") || !result.executed) writeJson(io, result);
    else {
      if (result.stdout) io.stdout(result.stdout);
      if (result.stderr) io.stderr(result.stderr);
    }
    if (result.timedOut) return 124;
    return result.exitCode ?? (result.executed ? 1 : 0);
  }

  if (command === "use") {
    const parsed = parseArguments(rest, [], ["--dry-run", "--yes", "--json"]);
    const name = parsed.positionals[0];
    const intent = parsed.positionals.slice(1).join(" ");
    if (!name || !intent) {
      throw new Error("Usage: cmdmint use <primitive> <intent> [--dry-run] [--yes]");
    }
    const manifest = await loadPrimitive(root, name);
    const selection = await selectMethod(manifest, intent, {
      ...(piBinary
        ? { compileSelection: async (prompt: string) => await compileWithPi(prompt, { piBinary }) }
        : {}),
    });
    const invocation = await executeMethod(
      manifest,
      selection.method,
      selection.args,
      {
        dryRun: optionBoolean(parsed, "--dry-run"),
        yes: optionBoolean(parsed, "--yes"),
      },
    );
    if (optionBoolean(parsed, "--json") || !invocation.executed) {
      writeJson(io, { selection, invocation });
    } else {
      if (invocation.stdout) io.stdout(invocation.stdout);
      if (invocation.stderr) io.stderr(invocation.stderr);
    }
    if (invocation.timedOut) return 124;
    return invocation.exitCode ?? (invocation.executed ? 1 : 0);
  }

  if (command === "ask") {
    const parsed = parseArguments(rest, [], ["--json"]);
    if (parsed.positionals.length === 0) {
      throw new Error("Usage: cmdmint ask [<primitive>] <question> [--json]");
    }
    const manifests = await listPrimitives(root);
    const requestedScope =
      parsed.positionals.length > 1
        ? manifests.find((manifest) => manifest.name === parsed.positionals[0])
        : undefined;
    const scope = requestedScope?.name ?? "all";
    const question = requestedScope
      ? parsed.positionals.slice(1).join(" ")
      : parsed.positionals.join(" ");
    const selectedManifests = requestedScope ? [requestedScope] : manifests;
    const result = await answerQuestion(
      question,
      await loadRegistryRecords(root, selectedManifests),
      {
        scope,
        ...(io.compileAnswer
          ? { compileAnswer: io.compileAnswer }
          : piBinary
          ? { compileAnswer: async (prompt: string) => await compileWithPi(prompt, { piBinary }) }
          : {}),
      },
    );
    if (optionBoolean(parsed, "--json")) writeJson(io, { scope, ...result });
    else {
      io.stdout(`${result.answer}\n`);
      if (result.sources.length > 0) {
        io.stdout(`Sources: ${result.sources.map((source) => source.id).join(", ")}\n`);
      }
    }
    return 0;
  }

  if (command === "doctor") {
    const parsed = parseArguments(rest, [], ["--json"]);
    if (parsed.positionals.length) throw new Error("Usage: cmdmint doctor [--json]");
    const report = await runDoctor({
      registryRoot: root,
      ...(piBinary ? { piBinary } : {}),
    });
    if (optionBoolean(parsed, "--json")) writeJson(io, report);
    else {
      for (const check of report.checks) {
        io.stdout(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}\n`);
      }
    }
    return report.ok ? 0 : 1;
  }

  throw new Error(`Unknown command: ${command}. Run cmdmint --help.`);
}

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  try {
    return await dispatch(args, io);
  } catch (error) {
    io.stderr(`cmdmint: ${(error as Error).message}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
