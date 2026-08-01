import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AskThreadTurn {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  sources?: string[];
  invocation?: {
    primitive: string;
    method: string;
    durationMs: number;
    exitCode: number | null;
  };
}

export interface AskThread {
  schemaVersion: 1;
  id: string;
  title: string;
  scope: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  turns: AskThreadTurn[];
}

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THREAD_PREFIX_PATTERN = /^[0-9a-f-]{1,36}$/;
const MAX_TITLE_CHARS = 120;
const DEFAULT_CONTEXT_CHARS = 12_000;

function threadsDirectory(root: string): string {
  return join(root, "threads");
}

function locksDirectory(root: string): string {
  return join(root, "thread-locks");
}

async function ensurePrivateDirectories(root: string): Promise<void> {
  await mkdir(threadsDirectory(root), { recursive: true, mode: 0o700 });
  await chmod(threadsDirectory(root), 0o700);
  await mkdir(locksDirectory(root), { recursive: true, mode: 0o700 });
  await chmod(locksDirectory(root), 0o700);
}

function validateThreadId(id: string): void {
  if (!THREAD_ID_PATTERN.test(id)) {
    throw new Error(`Invalid thread id: ${id}`);
  }
}

function validateThreadIdOrPrefix(idOrPrefix: string): void {
  if (!THREAD_PREFIX_PATTERN.test(idOrPrefix.toLowerCase())) {
    throw new Error(`Invalid thread id or prefix: ${idOrPrefix}`);
  }
}

function titleFor(question: string): string {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (normalized.length <= MAX_TITLE_CHARS) return normalized || "Untitled thread";
  return `${normalized.slice(0, MAX_TITLE_CHARS - 3)}...`;
}

function threadPath(root: string, id: string): string {
  validateThreadId(id);
  return join(threadsDirectory(root), `${id}.jsonl`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid thread record: ${key} must be a non-empty string`);
  }
  return value;
}

function parseInvocation(value: unknown): AskThreadTurn["invocation"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Invalid thread invocation record");
  const primitive = requiredString(value, "primitive");
  const method = requiredString(value, "method");
  const durationMs = value.durationMs;
  const exitCode = value.exitCode;
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    (typeof exitCode !== "number" && exitCode !== null)
  ) {
    throw new Error("Invalid thread invocation record");
  }
  return { primitive, method, durationMs, exitCode };
}

function parseSources(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((source) => typeof source !== "string")) {
    throw new Error("Invalid thread sources record");
  }
  return [...value];
}

function parseThreadContents(contents: string, expectedId?: string): AskThread {
  const lines = contents.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("Malformed thread JSONL: file is empty");

  let first: unknown;
  try {
    first = JSON.parse(lines[0]!);
  } catch (error) {
    throw new Error("Malformed thread JSONL metadata", { cause: error });
  }
  if (!isRecord(first) || first.type !== "cmdmint_thread" || first.schemaVersion !== 1) {
    throw new Error("Invalid cmdmint thread metadata record");
  }

  const id = requiredString(first, "id");
  validateThreadId(id);
  if (expectedId !== undefined && id !== expectedId) {
    throw new Error("Thread filename does not match its metadata id");
  }
  const thread: AskThread = {
    schemaVersion: 1,
    id,
    title: requiredString(first, "title"),
    scope: requiredString(first, "scope"),
    cwd: requiredString(first, "cwd"),
    createdAt: requiredString(first, "createdAt"),
    updatedAt: requiredString(first, "updatedAt"),
    turns: [],
  };

  for (const line of lines.slice(1)) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error("Malformed thread JSONL message", { cause: error });
    }
    if (!isRecord(value) || value.type !== "message") {
      throw new Error("Invalid cmdmint thread message record");
    }
    const role = value.role;
    if (role !== "user" && role !== "assistant") {
      throw new Error("Invalid cmdmint thread message role");
    }
    const turn: AskThreadTurn = {
      role,
      text: requiredString(value, "text"),
      timestamp: requiredString(value, "timestamp"),
    };
    const sources = parseSources(value.sources);
    if (sources !== undefined) turn.sources = sources;
    const invocation = parseInvocation(value.invocation);
    if (invocation !== undefined) turn.invocation = invocation;
    thread.turns.push(turn);
  }
  return thread;
}

function metadataRecord(thread: AskThread): Record<string, unknown> {
  return {
    type: "cmdmint_thread",
    schemaVersion: 1,
    id: thread.id,
    title: thread.title,
    scope: thread.scope,
    cwd: thread.cwd,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function messageRecord(turn: AskThreadTurn): Record<string, unknown> {
  const record: Record<string, unknown> = {
    type: "message",
    role: turn.role,
    text: turn.text,
    timestamp: turn.timestamp,
  };
  if (turn.sources !== undefined) record.sources = turn.sources;
  if (turn.invocation !== undefined) record.invocation = turn.invocation;
  return record;
}

function serializeThread(thread: AskThread): string {
  return `${[metadataRecord(thread), ...thread.turns.map(messageRecord)]
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
}

async function writeThreadAtomic(root: string, thread: AskThread): Promise<void> {
  await ensurePrivateDirectories(root);
  const target = threadPath(root, thread.id);
  const temporaryPath = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, serializeThread(thread), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, target);
    await chmod(target, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function threadFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(threadsDirectory(root), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        THREAD_ID_PATTERN.test(entry.name.slice(0, -".jsonl".length)),
    )
    .map((entry) => entry.name);
}

async function resolveThreadId(root: string, idOrPrefix: string): Promise<string> {
  validateThreadIdOrPrefix(idOrPrefix);
  const normalized = idOrPrefix.toLowerCase();
  const matches = (await threadFiles(root))
    .map((file) => file.slice(0, -".jsonl".length))
    .filter((id) => id.startsWith(normalized));
  if (matches.length === 0) throw new Error(`Thread not found: ${idOrPrefix}`);
  if (matches.length > 1) throw new Error(`Ambiguous thread prefix: ${idOrPrefix}`);
  return matches[0]!;
}

export async function createThread(
  root: string,
  input: { scope: string; cwd: string; question: string },
): Promise<AskThread> {
  await ensurePrivateDirectories(root);
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title: titleFor(input.question),
    scope: input.scope,
    cwd: input.cwd,
    createdAt: timestamp,
    updatedAt: timestamp,
    turns: [],
  };
}

export async function loadThread(root: string, idOrPrefix: string): Promise<AskThread> {
  const id = await resolveThreadId(root, idOrPrefix);
  const contents = await readFile(threadPath(root, id), "utf8");
  return parseThreadContents(contents, id);
}

export async function listThreads(root: string): Promise<AskThread[]> {
  const files = await threadFiles(root);
  const threads = await Promise.all(
    files.map(async (file) => {
      const id = file.slice(0, -".jsonl".length);
      const contents = await readFile(join(threadsDirectory(root), file), "utf8");
      return parseThreadContents(contents, id);
    }),
  );
  return threads.sort((left, right) => {
    const timestampOrder = right.updatedAt.localeCompare(left.updatedAt);
    return timestampOrder || right.id.localeCompare(left.id);
  });
}

export async function recordExchange(
  root: string,
  thread: AskThread,
  exchange: {
    question: string;
    answer: string;
    sources?: string[];
    invocation?: AskThreadTurn["invocation"];
  },
): Promise<AskThread> {
  validateThreadId(thread.id);
  const now = new Date().toISOString();
  const userTurn: AskThreadTurn = {
    role: "user",
    text: exchange.question,
    timestamp: now,
  };
  const assistantTurn: AskThreadTurn = {
    role: "assistant",
    text: exchange.answer,
    timestamp: new Date().toISOString(),
  };
  if (exchange.sources !== undefined) assistantTurn.sources = [...exchange.sources];
  if (exchange.invocation !== undefined) assistantTurn.invocation = exchange.invocation;
  const updated: AskThread = {
    ...thread,
    updatedAt: assistantTurn.timestamp,
    turns: [...thread.turns, userTurn, assistantTurn],
  };
  await writeThreadAtomic(root, updated);
  return updated;
}

function renderTurn(turn: AskThreadTurn): string {
  const label =
    turn.role === "assistant"
      ? "ASSISTANT (navigation context, not authoritative evidence)"
      : "USER";
  const sourceSuffix = turn.sources?.length ? `\nCited source IDs: ${turn.sources.join(", ")}` : "";
  return `${label}:\n${turn.text}${sourceSuffix}`;
}

export function extractReferences(text: string): string[] {
  const references = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  return [...new Set(references.map((reference) => reference.toLowerCase()))];
}

export function buildFollowUpQuestion(
  thread: AskThread,
  question: string,
  maxChars = DEFAULT_CONTEXT_CHARS,
): string {
  const limit = Math.max(1, Math.floor(maxChars));
  const current = question.trim();
  const prefix =
    `Durable cmdmint thread navigation context, not authoritative evidence. ` +
    `Re-check the underlying learned evidence or source conversation before answering.\n` +
    `Thread scope: ${thread.scope}\n` +
    `Prior transcript:\n`;
  const currentLabel = "\nCurrent follow-up:\n";
  const renderedTurns = thread.turns.map(renderTurn).join("\n\n");
  const full = `${prefix}${renderedTurns}${currentLabel}${current}`;
  if (full.length <= limit) return full;

  const preservedCurrent = current.slice(0, Math.max(0, limit - currentLabel.length));
  const availableContext = Math.max(0, limit - currentLabel.length - preservedCurrent.length);
  const context = `${prefix}${renderedTurns}`;
  const truncatedContext = context.slice(-availableContext);
  return `${truncatedContext}${currentLabel}${preservedCurrent}`.slice(0, limit);
}

export async function withThreadLock<T>(
  root: string,
  id: string,
  action: () => Promise<T>,
): Promise<T> {
  validateThreadId(id);
  await ensurePrivateDirectories(root);
  const lockPath = join(locksDirectory(root), `${id}.lock`);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Thread is already being continued: ${id}`);
    }
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`, { encoding: "utf8" });
    return await action();
  } finally {
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}
