# Durable Clihow Ask Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every completed `clihow ask` exchange as a durable, searchable thread that can be continued by ID from another terminal and selected through the existing `agentconvos` Textual TUI or `fzf` finder.

**Architecture:** `clihow` owns the authoritative logical-thread transcript under `$CLIHOW_HOME/threads`; it never depends on a hidden Pi or Luna session for continuity. Each follow-up replays a bounded, explicitly labeled transcript into a fresh model or delegated read-only question entrypoint. `agentconvos` gains `clihow` as a first-class source and reuses its existing search index, TUI, fuzzy finder, and native-resume dispatch instead of introducing a second picker.

**Tech Stack:** Node.js 22, TypeScript, append-safe JSONL with atomic replacement, Python 3.12, Textual, Rich, `fzf`, Node test runner, Python `unittest`.

---

## Product contract

The finished interface is:

```bash
# Start a durable thread. Plain output stays compatible; the thread ID is written to stderr.
clihow ask agentconvos "find the MCP selector conversation"

# Continue from any terminal. The original scope comes from the stored thread.
clihow ask --thread 019f... "what exactly did turn 26 implement?"

# With no follow-up text, prompt once when stdin is interactive.
clihow ask --thread 019f...

# Browse all clihow threads in the existing Textual application.
clihow threads

# Use the existing lightweight fzf picker.
clihow threads --find "MCP selector"

# Machine-readable inventory without starting another process.
clihow threads --json

# Existing agentconvos surfaces also work.
agentconvos --source clihow --search "MCP selector" --json
agentconvos --resume 019f... --dry-run
```

Rules:

- Store all completed user/assistant turns; do not store an opaque provider session as the source of truth.
- A thread is permanently addressed by a UUID, and unique UUID prefixes are accepted.
- There is no global implicit `last`: different terminals and agents must not silently collide.
- A continuation may omit the primitive because the stored thread owns its scope. If the caller repeats a primitive, it must match.
- Prior assistant answers are navigation context, not authoritative evidence. Follow-ups must re-check the underlying learned evidence or source conversations.
- `--show-prompt` remains non-mutating and creates no thread.
- JSON output includes `threadId`; non-JSON output preserves answer stdout and writes the continuation hint to stderr.
- Interactive delegated asks retain the live Rich cockpit while clihow captures the final stdout answer for persistence.
- Thread files and temporary replacements use mode `0600`; the thread directory uses `0700`.
- A per-thread lock fails closed on concurrent continuations instead of corrupting order.

## File map

### `/home/testycool/Work/try-rs/clihow`

- Create `src/threads.ts`: thread schema, UUID/prefix resolution, atomic JSONL persistence, locking, listing, reference extraction, and bounded follow-up context.
- Create `src/thread-browser.ts`: optional bridge to `agentconvos` for Textual/fzf browsing.
- Modify `src/process.ts`: add capture-and-forward (`tee`) process mode.
- Modify `src/invoke.ts`: pass tee callbacks and an explicit child environment.
- Modify `src/cli.ts`: `--thread`, interactive follow-up prompting, automatic persistence, `clihow threads`, help, and JSON contracts.
- Create `tests/threads.test.ts`: storage, prefix, locking, permissions, context bounding, and corruption tests.
- Modify `tests/process.test.ts`, `tests/invoke.test.ts`, and `tests/cli.test.ts`: tee and public command behavior.
- Modify `README.md` and `skills/clihow/SKILL.md`: durable-thread usage and the logical-thread/provider-session distinction.

### `/home/testycool/Work/convo-explorer`

- Modify `src/agentconvos/parser.py`: detect and parse clihow JSONL threads.
- Modify `src/agentconvos/scanner.py`: scan `$CLIHOW_HOME/threads` and group by cwd.
- Modify `src/agentconvos/app.py`: source labels/order/filter, TUI resume, fzf visibility, and `_resume_cmd("clihow", ...)`.
- Modify `src/agentconvos/recall.py`: preserve the cockpit through clihow tee mode and treat prior clihow answers as navigation rather than primary evidence.
- Create `tests/test_clihow_threads.py`: parser, scanner, filtering, resume argv, and forced-terminal tests.
- Modify `README.md`: document clihow as a source and distinguish continuing a clihow research thread from resuming its cited native agent session.

---

### Task 1: Add the durable clihow thread store

**Files:**
- Create: `src/threads.ts`
- Create: `tests/threads.test.ts`

- [ ] **Step 1: Write failing storage and context tests**

Cover this exact public contract:

```ts
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildFollowUpQuestion,
  createThread,
  listThreads,
  loadThread,
  recordExchange,
  withThreadLock,
} from "../src/threads.ts";

test("stores and resolves a completed thread by UUID prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "clihow-threads-"));
  const thread = await createThread(root, {
    scope: "agentconvos",
    cwd: "/work/demo",
    question: "Find the MCP selector conversation",
  });
  await recordExchange(root, thread, {
    question: "Find the MCP selector conversation",
    answer: "Found session 019f0000-0000-7000-8000-000000000001.",
    sources: ["019f0000-0000-7000-8000-000000000001"],
  });

  assert.equal((await loadThread(root, thread.id.slice(0, 8))).id, thread.id);
  assert.equal((await listThreads(root))[0]?.turns.length, 2);
  assert.equal((await stat(join(root, "threads", `${thread.id}.jsonl`))).mode & 0o777, 0o600);
  assert.match(await readFile(join(root, "threads", `${thread.id}.jsonl`), "utf8"), /clihow_thread/);
});

test("follow-up context is bounded and labels prior answers as untrusted", async () => {
  const rendered = buildFollowUpQuestion(
    {
      schemaVersion: 1,
      id: "019f0000-0000-7000-8000-000000000001",
      title: "Find the session",
      scope: "agentconvos",
      cwd: "/work/demo",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z",
      turns: [
        { role: "user", text: "Find it", timestamp: "2026-08-01T00:00:00.000Z" },
        { role: "assistant", text: "Prior answer", timestamp: "2026-08-01T00:00:01.000Z" },
      ],
    },
    "What did it implement?",
    2048,
  );

  assert.match(rendered, /navigation context, not authoritative evidence/i);
  assert.match(rendered, /Current follow-up:\nWhat did it implement\?/);
  assert.ok(rendered.length <= 2048);
});

test("rejects a second writer while a thread lock is held", async () => {
  const root = await mkdtemp(join(tmpdir(), "clihow-thread-lock-"));
  const thread = await createThread(root, {
    scope: "agentconvos",
    cwd: "/work/demo",
    question: "Find it",
  });
  await withThreadLock(root, thread.id, async () => {
    await assert.rejects(
      withThreadLock(root, thread.id, async () => undefined),
      /already being continued/i,
    );
  });
});
```

Also test ambiguous prefixes, malformed JSONL, missing threads, title truncation, and `0700` on the containing directory.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm exec tsx --test tests/threads.test.ts
```

Expected: FAIL because `src/threads.ts` does not exist.

- [ ] **Step 3: Implement the thread schema and persistence**

Use these exported types and functions; keep provider-specific session state out of the schema:

```ts
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

export async function createThread(
  root: string,
  input: { scope: string; cwd: string; question: string },
): Promise<AskThread>;

export async function loadThread(root: string, idOrPrefix: string): Promise<AskThread>;
export async function listThreads(root: string): Promise<AskThread[]>;
export async function recordExchange(
  root: string,
  thread: AskThread,
  exchange: {
    question: string;
    answer: string;
    sources?: string[];
    invocation?: AskThreadTurn["invocation"];
  },
): Promise<AskThread>;
export function buildFollowUpQuestion(
  thread: AskThread,
  question: string,
  maxChars?: number,
): string;
export async function withThreadLock<T>(
  root: string,
  id: string,
  action: () => Promise<T>,
): Promise<T>;
```

Serialize one metadata record followed by message records:

```json
{"type":"clihow_thread","schemaVersion":1,"id":"UUID","title":"First question","scope":"agentconvos","cwd":"/work/demo","createdAt":"ISO","updatedAt":"ISO"}
{"type":"message","role":"user","text":"First question","timestamp":"ISO"}
{"type":"message","role":"assistant","text":"Answer","timestamp":"ISO","sources":["SOURCE_ID"]}
```

`createThread` allocates an in-memory thread and ensures the private directories exist, but does not publish a searchable transcript. `recordExchange` receives that thread object, appends the completed user/assistant pair, writes the complete next JSONL to a sibling temporary file with mode `0600`, then renames it. Existing continuations load the thread inside the lock before calling `recordExchange`. Lock files live under `$CLIHOW_HOME/thread-locks`; use exclusive creation and always remove the lock in `finally`. Reject invalid IDs before constructing paths.

- [ ] **Step 4: Run focused and full clihow checks**

Run:

```bash
pnpm exec tsx --test tests/threads.test.ts
pnpm check
```

Expected: all tests and `tsc` pass.

- [ ] **Step 5: Commit the storage checkpoint**

```bash
git add src/threads.ts tests/threads.test.ts
git commit -m "Persist durable clihow ask threads"
```

---

### Task 2: Capture and forward interactive delegated output

**Files:**
- Modify: `src/process.ts`
- Modify: `src/invoke.ts`
- Modify: `tests/process.test.ts`
- Modify: `tests/invoke.test.ts`

- [ ] **Step 1: Write failing tee-mode tests**

Add a process test that asserts the same chunks are captured and forwarded:

```ts
test("tee mode forwards and captures both streams", async () => {
  const { runProcess } = await import("../src/process.ts");
  const liveStdout: string[] = [];
  const liveStderr: string[] = [];
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('answer'); process.stderr.write('cockpit')"],
    {
      stdio: "tee",
      onStdout: (value) => liveStdout.push(value),
      onStderr: (value) => liveStderr.push(value),
    },
  );

  assert.equal(result.stdout, "answer");
  assert.equal(result.stderr, "cockpit");
  assert.equal(liveStdout.join(""), "answer");
  assert.equal(liveStderr.join(""), "cockpit");
});
```

Add an invocation test proving `env` and callbacks reach `runProcess` without enabling a shell.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm exec tsx --test tests/process.test.ts tests/invoke.test.ts
```

Expected: FAIL because `tee`, `onStdout`, `onStderr`, and invocation `env` are unsupported.

- [ ] **Step 3: Add tee without changing capture or inherit semantics**

Extend the option contracts exactly:

```ts
export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  stdio?: "capture" | "inherit" | "tee";
  onStdout?: (value: string) => void;
  onStderr?: (value: string) => void;
  timeoutMs?: number;
}

export interface ExecuteMethodOptions {
  dryRun?: boolean;
  stdio?: "capture" | "inherit" | "tee";
  env?: NodeJS.ProcessEnv;
  onStdout?: (value: string) => void;
  onStderr?: (value: string) => void;
  timeoutMs?: number;
  yes?: boolean;
}
```

`tee` uses `stdio: ["inherit", "pipe", "pipe"]`, applies the same 1 MiB bounded capture as normal capture, and forwards each raw UTF-8 chunk through the supplied callback. Preserve `shell: false`, timeout process-group killing, and the existing `inherit` behavior.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec tsx --test tests/process.test.ts tests/invoke.test.ts
pnpm check
git add src/process.ts src/invoke.ts tests/process.test.ts tests/invoke.test.ts
git commit -m "Capture delegated output while streaming it live"
```

---

### Task 3: Make `clihow ask` create and continue threads

**Files:**
- Create: `src/thread-browser.ts`
- Modify: `src/cli.ts`
- Modify: `tests/cli.test.ts`
- Modify: `tests/help.test.ts`

- [ ] **Step 1: Write failing CLI contract tests**

Add tests for all of these behaviors:

```ts
// New delegated ask: answer remains unchanged, stderr contains the thread ID,
// and the JSONL has one user and one assistant turn.
await runCli(["ask", "demo", "first question"], io);

// JSON callers get an explicit ID without terminal noise.
const value = JSON.parse(stdout.join(""));
assert.match(value.threadId, /^[0-9a-f-]{36}$/);

// A continuation restores scope from the thread and passes labeled history
// plus only the new follow-up as the current question.
await runCli(["ask", "--thread", value.threadId, "clarify that"], io);

// An explicit mismatched primitive fails before invoking either model or CLI.
await runCli(["ask", "other", "--thread", value.threadId, "clarify"], io);

// Preview reads prior context but does not modify the thread file.
await runCli(["ask", "--thread", value.threadId, "clarify", "--show-prompt", "--json"], io);

// An interactive resume with no text calls the injected question reader once.
await runCli(["ask", "--thread", value.threadId], {
  ...io,
  interactive: true,
  readQuestion: async () => "What changed?",
});

// Thread inventory is native and machine-readable.
await runCli(["threads", "--json"], io);

// Interactive and fuzzy browsing dispatch only the documented agentconvos argv.
await runCli(["threads"], {
  ...io,
  browseThreads: async (argv) => {
    observed.push(argv);
    return 0;
  },
});
await runCli(["threads", "--find", "MCP", "selector"], {
  ...io,
  browseThreads: async (argv) => {
    observed.push(argv);
    return 0;
  },
});
assert.deepEqual(observed, [
  ["--source", "clihow"],
  ["--source", "clihow", "--find", "MCP selector"],
]);
```

Assert that a failed ask and every `--show-prompt` path leave `$CLIHOW_HOME/threads` unchanged. Assert that interactive delegated asks use `tee`, set `CLIHOW_STREAM_TTY=1`, preserve the Rich stderr stream, and persist only the final stdout answer.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec tsx --test tests/cli.test.ts tests/help.test.ts
```

Expected: FAIL because `--thread`, `threads`, `readQuestion`, and `browseThreads` do not exist.

- [ ] **Step 3: Add browser and prompt seams**

Extend `CliIo`:

```ts
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
```

Implement `src/thread-browser.ts` as a shell-free optional bridge:

```ts
import { runProcess } from "./process.js";

export async function browseThreads(argv: string[]): Promise<number> {
  const result = await runProcess("agentconvos", argv, {
    stdio: "inherit",
    timeoutMs: 24 * 60 * 60_000,
  });
  return result.exitCode ?? 1;
}
```

The default `readQuestion` uses `node:readline/promises`, writes `Follow-up> ` to stderr, trims the result, and always closes the interface.

- [ ] **Step 4: Integrate logical threads into both ask paths**

Parse `--thread` as a value option. Resolve a continuation before scope selection, and use its stored scope. Build a labeled follow-up with `buildFollowUpQuestion`; never pass prior text as system instructions.

For delegated asks, replace interactive `inherit` with:

```ts
{
  stdio: "tee",
  env: { ...io.env, CLIHOW_STREAM_TTY: "1" },
  onStdout: io.stdout,
  onStderr: io.stderr,
  timeoutMs: 10 * 60_000,
}
```

After a successful answer, create or update the thread under `withThreadLock`. New asks allocate an ID in memory but do not publish a searchable file until the answer succeeds, preventing the running question from matching itself in `agentconvos`. For JSON output, include `threadId`. For plain output, preserve stdout and write this to stderr after the answer:

```text
Thread: UUID
Continue: clihow ask --thread UUID "follow-up"
```

Model-backed asks store `result.answer` and `result.sources[].id`. Delegated asks store `invocation.stdout.trim()` and UUID-like references extracted from the answer. Do not store Rich control output from stderr.

- [ ] **Step 5: Add `clihow threads` and root help**

Behavior:

```text
clihow threads --json                  native JSON inventory, newest first
clihow threads                         agentconvos --source clihow
clihow threads --find [QUERY...]       agentconvos --source clihow --find QUERY
```

If `agentconvos` is unavailable, print a direct error that recommends `clihow threads --json`; do not silently fall back to another picker.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec tsx --test tests/cli.test.ts tests/help.test.ts
pnpm check
git add src/cli.ts src/thread-browser.ts tests/cli.test.ts tests/help.test.ts
git commit -m "Continue clihow questions through durable threads"
```

---

### Task 4: Index clihow threads in agentconvos

**Files:**
- Modify: `/home/testycool/Work/convo-explorer/src/agentconvos/parser.py`
- Modify: `/home/testycool/Work/convo-explorer/src/agentconvos/scanner.py`
- Create: `/home/testycool/Work/convo-explorer/tests/test_clihow_threads.py`

- [ ] **Step 1: Write failing parser and scanner tests**

Create a real three-line clihow JSONL fixture in a temporary `$CLIHOW_HOME/threads` directory and assert:

```python
meta = get_meta(thread_path)
self.assertEqual(meta.source, "clihow")
self.assertEqual(meta.uuid, thread_id)
self.assertEqual(meta.cwd, "/work/demo")
self.assertEqual(meta.preview, "Find the MCP selector conversation")
self.assertEqual(
    [(turn.role, turn.text) for turn in parse_jsonl(thread_path)],
    [("user", "Find it"), ("assistant", "Found session 019f...")],
)

projects = scan_projects(source="clihow")
self.assertEqual([c.uuid for p in projects for c in p.conversations], [thread_id])
```

Also assert malformed records are ignored safely, updated timestamps come from the metadata record, `$CLIHOW_HOME` overrides the default, and `source="codex"` excludes clihow.

- [ ] **Step 2: Run and verify RED**

```bash
.venv/bin/python -m unittest tests.test_clihow_threads -v
```

Expected: FAIL because clihow is detected as Claude and is not scanned.

- [ ] **Step 3: Add the parser format**

Teach `_detect_format` to return `clihow` only when the first record is a dict with all of:

```python
record.get("type") == "clihow_thread"
record.get("schemaVersion") == 1
isinstance(record.get("id"), str)
```

Implement `_get_meta_clihow` and `_parse_jsonl_clihow`. Only `role in {"user", "assistant"}` and non-empty string `text` become turns. Metadata maps `id -> uuid`, `title -> slug`, `updatedAt -> timestamp`, `cwd -> cwd`, first user text or title -> preview, and literal `clihow -> source`.

- [ ] **Step 4: Scan and group the new source**

Add:

```python
def _clihow_threads_dir() -> Path:
    root = Path(os.environ.get("CLIHOW_HOME", Path.home() / ".local" / "share" / "clihow"))
    return root / "threads"
```

Scan `*.jsonl`, use `_get_meta_cached`, group by `cwd`, and expose virtual projects as `[clihow] CWD`. Update cache version because format detection and source coverage changed. Update the source docstring.

- [ ] **Step 5: Verify and commit the parser/scanner checkpoint**

```bash
.venv/bin/python -m unittest tests.test_clihow_threads -v
.venv/bin/python -m unittest discover -s tests
git add src/agentconvos/parser.py src/agentconvos/scanner.py tests/test_clihow_threads.py
git commit -m "Index clihow question threads as conversations"
```

---

### Task 5: Reuse the agentconvos TUI, fzf, and resume path

**Files:**
- Modify: `/home/testycool/Work/convo-explorer/src/agentconvos/app.py`
- Modify: `/home/testycool/Work/convo-explorer/src/agentconvos/recall.py`
- Modify: `/home/testycool/Work/convo-explorer/tests/test_clihow_threads.py`
- Modify: `/home/testycool/Work/convo-explorer/tests/test_recall.py`

- [ ] **Step 1: Write failing source/resume/TTY tests**

Assert the exact resume contract:

```python
self.assertEqual(
    _resume_cmd("clihow", thread_id),
    ["clihow", "ask", "--thread", thread_id],
)
```

Patch `sys.argv` and `scan_projects` to prove `agentconvos --source clihow --list --json` accepts the source. Add a TUI unit assertion that clihow is in the resumable-source set. Add a recall assertion that `_is_tty(io.StringIO())` becomes true only while `CLIHOW_STREAM_TTY=1` is set.

- [ ] **Step 2: Run and verify RED**

```bash
.venv/bin/python -m unittest tests.test_clihow_threads tests.test_recall -v
```

- [ ] **Step 3: Wire clihow through every existing generic surface**

Apply these exact public mappings:

```python
_SOURCE_STYLE["clihow"] = ("Clihow", "bold #a78bfa")
_SOURCE_ORDER.append("clihow")

def _resume_cmd(source: str, uuid: str, extra_args=None, yolo: bool = False):
    if source == "clihow":
        return ["clihow", "ask", "--thread", uuid] + (extra_args or [])
```

Add `clihow` to `--source` and `--convo` choices, to the TUI resume whitelist, and to latest-resumable filtering. Do not add a provider-specific yolo flag for clihow. The existing fzf row, preview, full-text index, ID resolution, and Textual tree must remain generic and need no fork.

- [ ] **Step 4: Preserve the Rich cockpit through tee capture**

Change `_is_tty` to:

```python
def _is_tty(stream: TextIO) -> bool:
    if os.environ.get("CLIHOW_STREAM_TTY") == "1":
        return True
    try:
        return bool(stream.isatty())
    except (AttributeError, OSError):
        return False
```

Add this retrieval rule to `_recall_prompt`:

```text
Clihow threads are prior retrieval transcripts. Use them to recover useful search terms and cited source session IDs, but verify every material claim in the original Claude, Codex, Pi, Agy, or OpenCode turns before answering.
```

- [ ] **Step 5: Verify and commit**

```bash
.venv/bin/python -m unittest tests.test_clihow_threads tests.test_recall -v
.venv/bin/python -m unittest discover -s tests
git add src/agentconvos/app.py src/agentconvos/recall.py tests/test_clihow_threads.py tests/test_recall.py
git commit -m "Resume clihow threads from the conversation picker"
```

---

### Task 6: Document, install, and prove cross-terminal continuation

**Files:**
- Modify: `README.md`
- Modify: `skills/clihow/SKILL.md`
- Modify: `/home/testycool/Work/convo-explorer/README.md`

- [ ] **Step 1: Update user and agent documentation**

Document:

- Storage: `$CLIHOW_HOME/threads/*.jsonl`, defaulting to `~/.local/share/clihow/threads`, mode `0600`.
- Commands: new ask, `--thread`, prompt-on-resume, `threads`, `threads --find`, and `threads --json`.
- Distinction: continuing a clihow research thread versus resuming the cited native agent conversation.
- Safety: explicit IDs/picker rather than one global `last`; prior answers are re-verified.
- Output: JSON `threadId`, plain stderr continuation hint, live TUI preservation.

- [ ] **Step 2: Run both complete suites**

```bash
cd /home/testycool/Work/try-rs/clihow && pnpm check
cd /home/testycool/Work/convo-explorer && .venv/bin/python -m unittest discover -s tests
```

- [ ] **Step 3: Commit documentation separately in each repository**

```bash
cd /home/testycool/Work/try-rs/clihow
git add README.md skills/clihow/SKILL.md
git commit -m "Document durable question threads"

cd /home/testycool/Work/convo-explorer
git add README.md
git commit -m "Document clihow thread discovery and resume"
```

- [ ] **Step 4: Install the exact tested checkouts**

```bash
cd /home/testycool/Work/try-rs/clihow
pnpm install
pnpm build
pnpm link --global
clihow doctor --json

cd /home/testycool/Work/convo-explorer
uv tool install --force --editable ".[ai]"
agentconvos --help | tail -8
```

Expected: doctor is green; global `agentconvos` includes `clihow` in `--source` choices.

- [ ] **Step 5: Run the real two-terminal smoke test**

In the Luna worker pane:

```bash
clihow ask agentconvos "find the conversation where I created the MCP selector launcher"
```

Record the emitted thread UUID and confirm the Rich cockpit completes. In a different Herdr pane:

```bash
clihow ask --thread THREAD_UUID "What repository did that work create, and which turns prove it?"
```

Acceptance:

- The second command needs no primitive name and resolves the original `agentconvos` scope.
- The second command displays the live cockpit and answers from original source turns.
- `clihow threads --json` shows one thread with four turns.
- `agentconvos --source clihow --search "MCP selector" --json` finds the same UUID.
- `agentconvos --resume THREAD_UUID --dry-run` prints `clihow ask --thread THREAD_UUID`.
- `clihow threads` opens the existing Textual picker with a Clihow source group, preview, and `R` resume action.
- `clihow threads --find "MCP selector"` opens the existing fzf picker and shows the same thread.

- [ ] **Step 6: Final clean-tree and commit audit**

```bash
git -C /home/testycool/Work/try-rs/clihow status --short --branch
git -C /home/testycool/Work/convo-explorer status --short --branch
git -C /home/testycool/Work/try-rs/clihow log -5 --oneline
git -C /home/testycool/Work/convo-explorer log -5 --oneline
```

Both worktrees must be clean. Report every full commit hash and exact commit message. Do not call the feature complete from unit tests alone.

---

## Self-review checklist

- The plan stores every successful ask thread and supports multiple independent threads.
- Cross-terminal continuation is explicit by UUID; there is no collision-prone global `last`.
- Plain, JSON, model-backed, delegated, preview, failure, interactive, and non-interactive paths have tests.
- Live TUI output remains visible while the final answer is captured.
- The current question is not searchable until its answer succeeds, preventing self-retrieval.
- Agentconvos indexes clihow without duplicating the picker or search engine.
- TUI, fzf, full-text search, preview, JSON listing, ID resolution, and resume are covered.
- Resuming a clihow research thread remains distinct from resuming a cited Codex/Claude/Pi/Agy/OpenCode session.
- Both repositories have isolated commits and full-suite plus live canary gates.
