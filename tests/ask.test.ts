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

const contaminatedEvidence: EvidenceBundle = {
  ...evidence,
  probes: [
    {
      ...evidence.probes[0]!,
      stdout:
        "Config file: /tmp/cmdmint-learn-r9Hotu/config/demo/config.toml\n",
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

test("grounds self questions in cmdmint runtime metadata", async () => {
  const { answerQuestion } = await import("../src/answer.ts");
  let prompt = "";

  const result = await answerQuestion(
    "where do you keep your data?",
    [{ manifest, evidence }],
    {
      scope: "all",
      runtime: {
        version: "0.1.0",
        registryRoot: "/home/test/.local/share/cmdmint",
      },
      compileAnswer: async (value) => {
        prompt = value;
        return JSON.stringify({
          answer: "cmdmint stores learned data in its registry.",
          sourceIds: ["cmdmint:runtime"],
          insufficientEvidence: false,
        });
      },
    },
  );

  assert.equal(result.sources[0]?.id, "cmdmint:runtime");
  assert.equal(result.sources[0]?.kind, "runtime");
  assert.match(prompt, /\/home\/test\/\.local\/share\/cmdmint/);
  assert.match(prompt, /first-person words such as "you" and "your" refer to cmdmint/i);
});

test("redacts legacy learning sandbox paths before Q&A", async () => {
  const { answerQuestion } = await import("../src/answer.ts");
  let prompt = "";

  await answerQuestion(
    "Where is the configuration?",
    [{ manifest, evidence: contaminatedEvidence }],
    {
      compileAnswer: async (value) => {
        prompt = value;
        return JSON.stringify({
          answer: "The captured path is from an ephemeral learning environment.",
          sourceIds: ["demo:evidence:sub:greet"],
          insufficientEvidence: true,
        });
      },
    },
  );

  assert.doesNotMatch(prompt, /\/tmp\/cmdmint-learn-r9Hotu/);
  assert.match(prompt, /<cmdmint-learning-home>\/config\/demo\/config\.toml/);
});

test("cmdmint ask answers global self questions from the active registry", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-self-"));
  try {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const io = {
      env: { ...process.env, CMDMINT_HOME: root },
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      compileAnswer: async () =>
        JSON.stringify({
          answer: `cmdmint stores its registry at ${root}.`,
          sourceIds: ["cmdmint:runtime"],
          insufficientEvidence: false,
        }),
    };

    assert.equal(
      await runCli(["ask", "where do you keep your data", "--json"], io),
      0,
      stderr.join(""),
    );
    const value = JSON.parse(stdout.join(""));
    assert.equal(value.scope, "all");
    assert.deepEqual(
      value.sources.map((source: { id: string; kind: string }) => [
        source.id,
        source.kind,
      ]),
      [["cmdmint:runtime", "runtime"]],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cmdmint ask supports an explicit cmdmint self scope", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-self-"));
  try {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let prompt = "";
    const io = {
      env: { ...process.env, CMDMINT_HOME: root },
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      compileAnswer: async (value: string) => {
        prompt = value;
        return JSON.stringify({
          answer: `cmdmint stores its registry at ${root}.`,
          sourceIds: ["cmdmint:runtime"],
          insufficientEvidence: false,
        });
      },
    };

    assert.equal(
      await runCli(["ask", "cmdmint", "where is your registry?", "--json"], io),
      0,
      stderr.join(""),
    );
    assert.equal(JSON.parse(stdout.join("")).scope, "cmdmint");
    assert.doesNotMatch(prompt, /demo:manifest/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
    assert.match(stderr.join(""), /Thread: [0-9a-f-]{36}\nContinue: cmdmint ask --thread [0-9a-f-]{36}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
