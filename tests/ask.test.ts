import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EvidenceBundle, PrimitiveManifest } from "../src/types.ts";

const manifest: PrimitiveManifest = {
  schemaVersion: 1,
  name: "demo",
  description: "Demonstrate a small learned CLI.",
  binary: {
    requested: "demo-cli",
    path: "/definitely/not/executed/demo-cli",
    version: "demo-cli 1.0.0",
    sha256: "a".repeat(64),
    size: 10,
    mtimeMs: 20,
  },
  learnedAt: "2026-07-31T12:00:00.000Z",
  engine: {
    kind: "pi",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    thinking: "high",
  },
  methods: [
    {
      name: "greet",
      description: "Greet one person.",
      risk: "read",
      argv: ["greet"],
      parameters: [],
      output: "text",
      evidenceId: "sub:greet",
      probe: { argv: ["greet", "--help"], expectExit: [0] },
    },
  ],
};

const evidence: EvidenceBundle = {
  schemaVersion: 1,
  requestedBinary: "demo-cli",
  resolvedPath: "/definitely/not/executed/demo-cli",
  probes: [
    {
      id: "sub:greet",
      argv: ["greet", "--help"],
      exitCode: 0,
      stdout: "Usage: demo-cli greet\nPrints hello.\n",
      stderr: "",
      timedOut: false,
      truncated: false,
    },
  ],
};

test("grounds answers in validated manifest and evidence source references", async () => {
  const answerModule = await import(
    new URL("../src/answer.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof answerModule?.answerQuestion, "function");
  let prompt = "";

  const result = await answerModule!.answerQuestion(
    "How do I print a greeting?",
    [{ manifest, evidence }],
    {
      compileAnswer: async (value: string) => {
        prompt = value;
        return JSON.stringify({
          answer: "Use the greet method.",
          sourceIds: ["demo:evidence:sub:greet", "demo:manifest"],
          insufficientEvidence: false,
        });
      },
    },
  );

  assert.equal(result.answer, "Use the greet method.");
  assert.equal(result.insufficientEvidence, false);
  assert.deepEqual(result.sources, [
    {
      id: "demo:evidence:sub:greet",
      primitive: "demo",
      kind: "evidence",
      evidenceId: "sub:greet",
    },
    { id: "demo:manifest", primitive: "demo", kind: "manifest" },
  ]);
  assert.match(prompt, /UNTRUSTED DATA/);
  assert.match(prompt, /Prints hello/);
  assert.match(prompt, /How do I print a greeting/);
});

test("rejects source references that were not supplied", async () => {
  const { answerQuestion } = await import("../src/answer.ts");
  await assert.rejects(
    answerQuestion("How?", [{ manifest, evidence }], {
      compileAnswer: async () =>
        JSON.stringify({
          answer: "Invented answer.",
          sourceIds: ["demo:evidence:not-collected"],
          insufficientEvidence: false,
        }),
    }),
    /unknown source/i,
  );
});

test("reports insufficient evidence explicitly without invoking Pi for an empty scope", async () => {
  const { answerQuestion } = await import("../src/answer.ts");
  let called = false;
  const result = await answerQuestion("Can it deploy?", [], {
    compileAnswer: async () => {
      called = true;
      return "";
    },
  });

  assert.equal(called, false);
  assert.equal(result.insufficientEvidence, true);
  assert.match(result.answer, /^Insufficient evidence:/);
  assert.deepEqual(result.sources, []);
});

test("cmdmint ask supports global and primitive scopes without executing learned binaries", async () => {
  const { runCli } = await import("../src/cli.ts");
  const { savePrimitive } = await import("../src/registry.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-ask-"));
  try {
    await savePrimitive(root, manifest, evidence);
    const stdout: string[] = [];
    const stderr: string[] = [];
    const prompts: string[] = [];
    const io = {
      env: {
        ...process.env,
        CMDMINT_HOME: root,
      },
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      compileAnswer: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({
          answer: "Use demo.greet.",
          sourceIds: ["demo:evidence:sub:greet"],
          insufficientEvidence: false,
        });
      },
    };

    assert.equal(
      await runCli(["ask", "What can I use?", "--json"], io),
      0,
      stderr.join(""),
    );
    let value = JSON.parse(stdout.join(""));
    assert.equal(value.scope, "all");
    assert.equal(value.sources[0].id, "demo:evidence:sub:greet");
    assert.match(prompts.at(-1) ?? "", /"scope":"all"/);

    stdout.length = 0;
    assert.equal(await runCli(["ask", "demo", "How do I greet?"], io), 0);
    assert.match(stdout.join(""), /^Use demo\.greet\.\nSources: demo:evidence:sub:greet\n$/);
    assert.match(prompts.at(-1) ?? "", /"scope":"demo"/);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
