import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
import type { AskThread } from "../src/threads.ts";

const FIRST_ID = "019f0000-0000-7000-8000-000000000001";
const SECOND_ID = "019f0000-0000-7000-8000-000000000002";

function metadata(id: string, updatedAt: string): string {
  return JSON.stringify({
    type: "cmdmint_thread",
    schemaVersion: 1,
    id,
    title: "Find it",
    scope: "agentconvos",
    cwd: "/work/demo",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt,
  });
}

async function writeThreadFixture(root: string, id: string): Promise<void> {
  await writeFile(
    join(root, "threads", `${id}.jsonl`),
    `${metadata(id, "2026-08-01T00:00:01.000Z")}\n${JSON.stringify({
      type: "message",
      role: "user",
      text: "Find it",
      timestamp: "2026-08-01T00:00:00.000Z",
    })}\n${JSON.stringify({
      type: "message",
      role: "assistant",
      text: "Found it",
      timestamp: "2026-08-01T00:00:01.000Z",
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

test("stores and resolves a completed thread by UUID prefix", async () => {
  const root = await mkdtemp(join(tmpdir(), "cmdmint-threads-"));
  try {
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
    assert.equal(
      (await stat(join(root, "threads", `${thread.id}.jsonl`))).mode & 0o777,
      0o600,
    );
    assert.match(
      await readFile(join(root, "threads", `${thread.id}.jsonl`), "utf8"),
      /cmdmint_thread/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("follow-up context is bounded and labels prior answers as untrusted", async () => {
  const rendered = buildFollowUpQuestion(
    {
      schemaVersion: 1,
      id: FIRST_ID,
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
  const root = await mkdtemp(join(tmpdir(), "cmdmint-thread-lock-"));
  try {
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects ambiguous and invalid thread prefixes", async () => {
  const root = await mkdtemp(join(tmpdir(), "cmdmint-thread-prefix-"));
  try {
    await writeFile(join(root, "threads"), "not a directory", { encoding: "utf8" }).catch(
      () => undefined,
    );
    await rm(join(root, "threads"), { force: true });
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "threads"), { mode: 0o700 }));
    await writeThreadFixture(root, FIRST_ID);
    await writeThreadFixture(root, SECOND_ID);

    await assert.rejects(loadThread(root, "019f0000"), /ambiguous/i);
    await assert.rejects(loadThread(root, "../secret"), /invalid thread id/i);
    await assert.rejects(loadThread(root, "not-a-thread"), /invalid thread id/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing and malformed thread files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cmdmint-thread-errors-"));
  try {
    await assert.rejects(loadThread(root, FIRST_ID), /not found|missing/i);

    const threadsDir = join(root, "threads");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(threadsDir, { mode: 0o700 }));
    await writeFile(
      join(threadsDir, `${FIRST_ID}.jsonl`),
      `${metadata(FIRST_ID, "2026-08-01T00:00:01.000Z")}\n{not-json}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await assert.rejects(loadThread(root, FIRST_ID), /invalid|malformed|JSON/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("truncates long titles and creates private storage directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "cmdmint-thread-permissions-"));
  try {
    const question = `${"A very long question ".repeat(20)}end`;
    const thread = await createThread(root, {
      scope: "agentconvos",
      cwd: "/work/demo",
      question,
    });
    assert.ok(thread.title.length < question.length);
    assert.ok(thread.title.length <= 120);

    await recordExchange(root, thread, {
      question,
      answer: "Done",
    });

    assert.equal((await stat(join(root, "threads"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "thread-locks"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "threads", `${thread.id}.jsonl`))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves invocation and source metadata on recorded turns", async () => {
  const root = await mkdtemp(join(tmpdir(), "cmdmint-thread-metadata-"));
  try {
    const thread = await createThread(root, {
      scope: "demo",
      cwd: "/work/demo",
      question: "Find it",
    });
    const updated = await recordExchange(root, thread, {
      question: "Find it",
      answer: "Found source",
      sources: [FIRST_ID],
      invocation: {
        primitive: "demo",
        method: "search",
        durationMs: 42,
        exitCode: 0,
      },
    });
    assert.deepEqual(updated.turns[0]?.sources, undefined);
    assert.deepEqual(updated.turns[1]?.sources, [FIRST_ID]);
    assert.deepEqual(updated.turns[1]?.invocation, {
      primitive: "demo",
      method: "search",
      durationMs: 42,
      exitCode: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const _typeCheckOnly: AskThread | undefined = undefined;
void _typeCheckOnly;
