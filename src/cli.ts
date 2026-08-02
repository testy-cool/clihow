#!/usr/bin/env node

import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import {
  answerQuestion,
  buildAnswerPrompt,
  type RegistryPrimitive,
} from "./answer.js";
import { runDoctor } from "./doctor.js";
import { executeMethod, type MethodArguments } from "./invoke.js";
import { buildLearningPrompt, learnPrimitive } from "./learner.js";
import { compileWithPi } from "./pi.js";
import { browseThreads as browseThreadPicker } from "./thread-browser.js";
import {
  listPrimitives,
  loadEvidence,
  loadPrimitive,
  registryHome,
  savePrimitive,
} from "./registry.js";
import { buildSelectionPrompt, selectMethod } from "./selector.js";
import {
  buildFollowUpQuestion,
  createThread,
  extractReferences,
  listThreads,
  loadThread,
  recordExchange,
  withThreadLock,
} from "./threads.js";
import type { PrimitiveManifest } from "./types.js";
import { testPrimitive } from "./verify.js";

export const VERSION = "0.1.0";

export interface CliIo {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
  interactive?: boolean;
  compileAnswer?: (prompt: string) => Promise<string>;
  readQuestion?: (prompt: string) => Promise<string>;
  browseThreads?: (argv: string[]) => Promise<number>;
}

const defaultIo: CliIo = {
  env: process.env,
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY),
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

function hasOption(parsed: ParsedArguments, name: string): boolean {
  return Object.hasOwn(parsed.options, name);
}

function positionalBeforeOption(args: string[], option: string): string | undefined {
  const optionIndex = args.findIndex(
    (token) => token === option || token.startsWith(`${option}=`),
  );
  if (optionIndex === -1) return undefined;
  return args.slice(0, optionIndex).find((token) => !token.startsWith("--"));
}

async function readFollowUpQuestion(io: CliIo): Promise<string> {
  if (io.readQuestion) return (await io.readQuestion("Follow-up> ")).trim();
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await readline.question("Follow-up> ")).trim();
  } finally {
    readline.close();
  }
}

function writeThreadHint(io: CliIo, threadId: string): void {
  io.stderr(`Thread: ${threadId}\nContinue: clihow ask --thread ${threadId} "follow-up"\n`);
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

function writePromptPreview(
  io: CliIo,
  parsed: ParsedArguments,
  prompt: string,
  context: Record<string, unknown>,
): void {
  if (optionBoolean(parsed, "--json")) writeJson(io, { ...context, prompt });
  else io.stdout(`${prompt}\n`);
}

function assertCompatiblePromptOptions(parsed: ParsedArguments): void {
  const tracePromptsSupplied = hasOption(parsed, "--trace-prompts");
  if (optionBoolean(parsed, "--show-prompt") && tracePromptsSupplied) {
    throw new Error("--show-prompt cannot be combined with --trace-prompts");
  }
  if (
    tracePromptsSupplied &&
    !optionString(parsed, "--trace-prompts")?.trim()
  ) {
    throw new Error("--trace-prompts requires a non-empty value");
  }
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
  return `clihow ${VERSION} - learn installed CLIs as tested primitives

Usage:
  clihow help <primitive> [--json]
  clihow learn <binary> [--name <name>] [--show-prompt] [--trace-prompts <directory>] [--json]
  clihow list [--json]
  clihow describe <primitive>[.<method>] [--json]
  clihow test <primitive> [--json]
  clihow call <primitive>.<method> [--args-json <json>] [--dry-run] [--yes] [--json]
  clihow use <primitive> <intent> [--show-prompt] [--trace-prompts <directory>] [--dry-run] [--yes] [--json]
  clihow ask [--thread <id>] <question> [--show-prompt] [--trace-prompts <directory>] [--json]
  clihow ask [--thread <id>] <primitive> <question> [--show-prompt] [--trace-prompts <directory>] [--json]
  clihow threads [--json]
  clihow threads --find <query...>
  clihow doctor [--json]

Learned primitives:
${learned}

Runtime:
  Learning, natural-language selection, and grounded Q&A use Pi with
  openai-codex/gpt-5.6-luna at High thinking. Learned methods execute
  deterministically without a shell. Write and destructive methods require --yes.
  Scoped ask delegates to validated read-only question entrypoints when present.
  Completed asks are durable threads; continue one explicitly with --thread or browse them with threads.

Prompt inspection:
  --show-prompt          Print the exact next prompt without calling Pi.
  --trace-prompts <dir>  Record exact prompts and captured Pi responses as private JSON files.
                         Stdout and stderr can be truncated at 1 MiB; the trace truncated field records it.

Environment:
  CLIHOW_HOME       Registry directory (default: ~/.local/share/clihow)
  CLIHOW_PI_BINARY  Pi executable override for testing or custom installs
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
    ...(manifest.ask ? { ask: manifest.ask } : {}),
    methods: manifest.methods.map((method) => ({
      name: method.name,
      description: method.description,
      risk: method.risk,
      output: method.output,
      parameters: method.parameters,
      evidenceId: method.evidenceId,
      call: `clihow call ${manifest.name}.${method.name}`,
    })),
  };
}

function primitiveHelp(manifest: PrimitiveManifest): string {
  const lines = [
    `${manifest.name} - ${manifest.description}`,
    `Binary: ${manifest.binary.requested} (${manifest.binary.version})`,
  ];
  if (manifest.ask) {
    lines.push(
      `Question entrypoint: clihow ask ${manifest.name} <question>`,
      `  delegates to ${manifest.name}.${manifest.ask.method}`,
    );
  }
  lines.push("", "Methods:");
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
    lines.push(`    clihow call ${manifest.name}.${method.name} --args-json '<json>'`);
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

  const piBinary = io.env.CLIHOW_PI_BINARY;

  if (command === "help") {
    const parsed = parseArguments(rest, [], ["--json"]);
    const name = parsed.positionals[0];
    if (!name) {
      if (parsed.positionals.length) throw new Error("Usage: clihow help <primitive> [--json]");
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
      throw new Error("Usage: clihow help <primitive> [--json]");
    }
    const manifest = await loadPrimitive(root, name);
    if (optionBoolean(parsed, "--json")) writeJson(io, primitiveHelpValue(manifest));
    else io.stdout(primitiveHelp(manifest));
    return 0;
  }

  if (command === "learn") {
    const parsed = parseArguments(
      rest,
      ["--name", "--max-subcommands", "--trace-prompts"],
      ["--json", "--show-prompt"],
    );
    assertCompatiblePromptOptions(parsed);
    const binary = parsed.positionals[0];
    if (!binary || parsed.positionals.length !== 1) {
      throw new Error(
        "Usage: clihow learn <binary> [--name <name>] [--show-prompt] [--trace-prompts <directory>] [--json]",
      );
    }
    const maxSubcommandsValue = optionString(parsed, "--max-subcommands");
    const maxSubcommands = maxSubcommandsValue
      ? Number.parseInt(maxSubcommandsValue, 10)
      : undefined;
    if (maxSubcommands !== undefined && (!Number.isInteger(maxSubcommands) || maxSubcommands < 1)) {
      throw new Error("--max-subcommands must be a positive integer");
    }
    const learningPromptOptions = {
      binary,
      name: optionString(parsed, "--name") ?? deriveName(binary),
      ...(maxSubcommands === undefined ? {} : { maxSubcommands }),
    };
    if (optionBoolean(parsed, "--show-prompt")) {
      writePromptPreview(
        io,
        parsed,
        await buildLearningPrompt(learningPromptOptions),
        {
          command: "learn",
          primitive: learningPromptOptions.name,
          binary,
        },
      );
      return 0;
    }
    const learnOptions = {
      ...learningPromptOptions,
      ...(piBinary ? { piBinary } : {}),
      ...(optionString(parsed, "--trace-prompts")
        ? { traceDirectory: optionString(parsed, "--trace-prompts")! }
        : {}),
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
        `Learned ${result.manifest.name}: ${String(result.manifest.methods.length)} methods, ${String(verification.methods.length)} probes passed\n`,
      );
    }
    return 0;
  }

  if (command === "list") {
    const parsed = parseArguments(rest, [], ["--json"]);
    if (parsed.positionals.length) throw new Error("Usage: clihow list [--json]");
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

  if (command === "threads") {
    const parsed = parseArguments(rest, ["--find"], ["--json"]);
    if (optionBoolean(parsed, "--json")) {
      if (hasOption(parsed, "--find") || parsed.positionals.length) {
        throw new Error("Usage: clihow threads [--json]");
      }
      writeJson(io, await listThreads(root));
      return 0;
    }
    const query = [optionString(parsed, "--find"), ...parsed.positionals]
      .filter((value): value is string => value !== undefined)
      .join(" ")
      .trim();
    if (hasOption(parsed, "--find") && !query) {
      throw new Error("--find requires a non-empty query");
    }
    if (!hasOption(parsed, "--find") && parsed.positionals.length) {
      throw new Error("Usage: clihow threads [--json] or clihow threads --find <query...>");
    }
    const argv = ["--source", "clihow"];
    if (query) argv.push("--find", query);
    return await (io.browseThreads ?? browseThreadPicker)(argv);
  }

  if (command === "describe") {
    const parsed = parseArguments(rest, [], ["--json"]);
    const targetValue = parsed.positionals[0];
    if (!targetValue || parsed.positionals.length !== 1) {
      throw new Error("Usage: clihow describe <primitive>[.<method>] [--json]");
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
      throw new Error("Usage: clihow test <primitive> [--json]");
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
      throw new Error("Usage: clihow call <primitive>.<method> [--args-json <json>]");
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
    const parsed = parseArguments(
      rest,
      ["--trace-prompts"],
      ["--dry-run", "--yes", "--json", "--show-prompt"],
    );
    assertCompatiblePromptOptions(parsed);
    const name = parsed.positionals[0];
    const intent = parsed.positionals.slice(1).join(" ");
    if (!name || !intent) {
      throw new Error(
        "Usage: clihow use <primitive> <intent> [--show-prompt] [--trace-prompts <directory>] [--dry-run] [--yes] [--json]",
      );
    }
    const manifest = await loadPrimitive(root, name);
    if (optionBoolean(parsed, "--show-prompt")) {
      writePromptPreview(io, parsed, buildSelectionPrompt(manifest, intent), {
        command: "use",
        primitive: name,
      });
      return 0;
    }
    const traceDirectory = optionString(parsed, "--trace-prompts");
    const selection = await selectMethod(manifest, intent, {
      ...(piBinary || traceDirectory
        ? {
            compileSelection: async (prompt: string) =>
              await compileWithPi(prompt, {
                ...(piBinary ? { piBinary } : {}),
                ...(traceDirectory ? { traceDirectory } : {}),
              }),
          }
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
    const parsed = parseArguments(
      rest,
      ["--trace-prompts", "--thread"],
      ["--json", "--show-prompt"],
    );
    assertCompatiblePromptOptions(parsed);
    const threadOption = optionString(parsed, "--thread");
    if (parsed.positionals.length === 0 && !threadOption) {
      throw new Error(
        "Usage: clihow ask [--thread <id>] [<primitive>] <question> [--show-prompt] [--trace-prompts <directory>] [--json]",
      );
    }
    const preview = optionBoolean(parsed, "--show-prompt");
    const preliminaryThread =
      threadOption && !preview ? await loadThread(root, threadOption) : undefined;

    const runAsk = async (): Promise<number> => {
      const thread = threadOption ? await loadThread(root, threadOption) : undefined;
      const manifests = await listPrimitives(root);
      let scope: string;
      let question: string;
      let requestedScope: PrimitiveManifest | undefined;

      if (thread) {
        const repeatedPrimitive =
          positionalBeforeOption(rest, "--thread") ??
          (parsed.positionals[0] === thread.scope ? parsed.positionals[0] : undefined);
        let questionPositionals = [...parsed.positionals];
        if (repeatedPrimitive !== undefined) {
          if (repeatedPrimitive !== thread.scope) {
            throw new Error(
              `Repeated primitive ${repeatedPrimitive} does not match thread scope ${thread.scope}`,
            );
          }
          questionPositionals = questionPositionals.slice(1);
        }
        scope = thread.scope;
        question = questionPositionals.join(" ");
        if (scope !== "all" && scope !== "clihow") {
          requestedScope = manifests.find((manifest) => manifest.name === scope);
          if (!requestedScope) {
            throw new Error(`Stored thread scope is no longer learned: ${scope}`);
          }
        }
      } else {
        const requestedSelfScope =
          parsed.positionals.length > 1 && parsed.positionals[0] === "clihow";
        requestedScope =
          parsed.positionals.length > 1 && !requestedSelfScope
            ? manifests.find((manifest) => manifest.name === parsed.positionals[0])
            : undefined;
        scope = requestedSelfScope ? "clihow" : requestedScope?.name ?? "all";
        question = requestedSelfScope || requestedScope
          ? parsed.positionals.slice(1).join(" ")
          : parsed.positionals.join(" ");
      }

      if (!question.trim()) {
        if (!thread || !io.interactive) {
          throw new Error(
            "Usage: clihow ask [--thread <id>] [<primitive>] <question> [--show-prompt] [--trace-prompts <directory>] [--json]",
          );
        }
        question = await readFollowUpQuestion(io);
      }
      if (!question.trim()) throw new Error("Question must not be empty");

      const followUpQuestion = thread
        ? buildFollowUpQuestion(thread, question)
        : question;
      if (requestedScope?.ask) {
        const binding = requestedScope.ask;
        const method = requestedScope.methods.find(
          (candidate) => candidate.name === binding.method,
        );
        const parameter = method?.parameters.find(
          (candidate) => candidate.name === binding.parameter,
        );
        if (
          !method ||
          method.risk !== "read" ||
          !parameter ||
          parameter.kind !== "positional" ||
          (parameter.type !== "string" && parameter.type !== "string[]") ||
          !parameter.required ||
          method.parameters.length !== 1
        ) {
          throw new Error(
            `Stored question entrypoint for ${requestedScope.name} is invalid; relearn the primitive`,
          );
        }
        if (optionString(parsed, "--trace-prompts")) {
          throw new Error(
            `Scoped ask for ${requestedScope.name} delegates directly and does not use a clihow model prompt`,
          );
        }
        const streamDelegate = Boolean(!optionBoolean(parsed, "--json") && !preview);
        const interactiveDelegate = Boolean(io.interactive && streamDelegate);
        const invocation = await executeMethod(
          requestedScope,
          binding.method,
          {
            [binding.parameter]: parameter.type === "string[]" ? [followUpQuestion] : followUpQuestion,
          },
          {
            dryRun: preview,
            stdio: streamDelegate ? "tee" : "capture",
            env: interactiveDelegate
              ? { ...io.env, CLIHOW_STREAM_TTY: "1" }
              : io.env,
            ...(streamDelegate
              ? { onStdout: io.stdout, onStderr: io.stderr }
              : {}),
            timeoutMs: 10 * 60_000,
          },
        );
        if (preview) {
          const previewValue = {
            command: "ask",
            scope: requestedScope.name,
            delegated: true,
            prompt: null,
            invocation,
          };
          if (optionBoolean(parsed, "--json")) writeJson(io, previewValue);
          else {
            io.stdout("No clihow model prompt; this question delegates directly.\n");
            writeJson(io, previewValue);
          }
          return 0;
        }

        const completed = invocation.executed && invocation.exitCode === 0 && !invocation.timedOut;
        let threadId: string | undefined;
        if (completed) {
          const threadToRecord =
            thread ??
            (await createThread(root, {
              scope,
              cwd: io.cwd ?? process.cwd(),
              question,
            }));
          const updated = thread
            ? await recordExchange(root, threadToRecord, {
                question,
                answer: invocation.stdout.trim(),
                sources: extractReferences(invocation.stdout),
                invocation: {
                  primitive: requestedScope.name,
                  method: binding.method,
                  durationMs: invocation.durationMs,
                  exitCode: invocation.exitCode,
                },
              })
            : await withThreadLock(root, threadToRecord.id, async () =>
                await recordExchange(root, threadToRecord, {
                  question,
                  answer: invocation.stdout.trim(),
                  sources: extractReferences(invocation.stdout),
                  invocation: {
                    primitive: requestedScope.name,
                    method: binding.method,
                    durationMs: invocation.durationMs,
                    exitCode: invocation.exitCode,
                  },
                }),
              );
          threadId = updated.id;
        }
        if (optionBoolean(parsed, "--json")) {
          writeJson(io, {
            scope: requestedScope.name,
            delegated: true,
            answer: invocation.stdout.trim(),
            invocation,
            ...(threadId ? { threadId } : {}),
          });
        } else if (!streamDelegate) {
          if (invocation.stdout) io.stdout(invocation.stdout);
          if (invocation.stderr) io.stderr(invocation.stderr);
        }
        if (threadId && !optionBoolean(parsed, "--json")) writeThreadHint(io, threadId);
        if (invocation.timedOut) return 124;
        return invocation.exitCode ?? (invocation.executed ? 1 : 0);
      }

      const selectedManifests = scope === "clihow"
        ? []
        : requestedScope
          ? [requestedScope]
          : manifests;
      const records = await loadRegistryRecords(root, selectedManifests);
      const runtime = { version: VERSION, registryRoot: root };
      if (preview) {
        writePromptPreview(
          io,
          parsed,
          buildAnswerPrompt(followUpQuestion, records, scope, runtime),
          { command: "ask", scope },
        );
        return 0;
      }
      const traceDirectory = optionString(parsed, "--trace-prompts");
      const result = await answerQuestion(
        followUpQuestion,
        records,
        {
          scope,
          runtime,
          ...(io.compileAnswer
            ? { compileAnswer: io.compileAnswer }
            : piBinary || traceDirectory
            ? {
                compileAnswer: async (prompt: string) =>
                  await compileWithPi(prompt, {
                    ...(piBinary ? { piBinary } : {}),
                    ...(traceDirectory ? { traceDirectory } : {}),
                  }),
              }
            : {}),
        },
      );
      const threadToRecord =
        thread ??
        (await createThread(root, {
          scope,
          cwd: io.cwd ?? process.cwd(),
          question,
        }));
      const updated = thread
        ? await recordExchange(root, threadToRecord, {
            question,
            answer: result.answer,
            sources: result.sources.map((source) => source.id),
          })
        : await withThreadLock(root, threadToRecord.id, async () =>
            await recordExchange(root, threadToRecord, {
              question,
              answer: result.answer,
              sources: result.sources.map((source) => source.id),
            }),
          );
      if (optionBoolean(parsed, "--json")) writeJson(io, { scope, ...result, threadId: updated.id });
      else {
        io.stdout(`${result.answer}\n`);
        if (result.sources.length > 0) {
          io.stdout(`Sources: ${result.sources.map((source) => source.id).join(", ")}\n`);
        }
        writeThreadHint(io, updated.id);
      }
      return 0;
    };

    return preliminaryThread
      ? await withThreadLock(root, preliminaryThread.id, runAsk)
      : await runAsk();
  }

  if (command === "doctor") {
    const parsed = parseArguments(rest, [], ["--json"]);
    if (parsed.positionals.length) throw new Error("Usage: clihow doctor [--json]");
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

  throw new Error(`Unknown command: ${command}. Run clihow --help.`);
}

export async function runCli(args: string[], io: CliIo = defaultIo): Promise<number> {
  try {
    return await dispatch(args, io);
  } catch (error) {
    io.stderr(`clihow: ${(error as Error).message}\n`);
    return 1;
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
