import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { EvidenceBundle, PrimitiveManifest } from "../src/types.ts";

const fixturePath = fileURLToPath(
  new URL("../fixtures/demo-cli.mjs", import.meta.url),
);
const piDraftPath = fileURLToPath(
  new URL("../fixtures/pi-draft.mjs", import.meta.url),
);
const piSelectionPath = fileURLToPath(
  new URL("../fixtures/pi-selection.mjs", import.meta.url),
);
const piAnswerPath = fileURLToPath(
  new URL("../fixtures/pi-answer.mjs", import.meta.url),
);
const piTraceContractPath = fileURLToPath(
  new URL("../fixtures/pi-trace-contract.mjs", import.meta.url),
);

async function saveDemoPrimitive(root: string): Promise<void> {
  const { savePrimitive } = await import("../src/registry.ts");
  const manifest: PrimitiveManifest = {
    schemaVersion: 1,
    name: "demo",
    description: "A deterministic demonstration CLI.",
    binary: {
      requested: fixturePath,
      path: fixturePath,
      version: "demo-cli 1.0.0",
      sha256: "a".repeat(64),
      size: 1,
      mtimeMs: 1,
    },
    learnedAt: "2026-08-01T00:00:00.000Z",
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
    requestedBinary: fixturePath,
    resolvedPath: fixturePath,
    probes: [],
  };
  await savePrimitive(root, manifest, evidence);
}

async function saveQuestionPrimitive(root: string): Promise<void> {
  const { sha256File } = await import("../src/binary.ts");
  const { savePrimitive } = await import("../src/registry.ts");
  const metadata = await stat(fixturePath);
  const manifest: PrimitiveManifest = {
    schemaVersion: 1,
    name: "demo",
    description: "A deterministic question-answering CLI.",
    binary: {
      requested: fixturePath,
      path: fixturePath,
      version: "demo-cli 1.0.0",
      sha256: await sha256File(fixturePath),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    },
    learnedAt: "2026-08-01T00:00:00.000Z",
    engine: {
      kind: "pi",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      thinking: "high",
    },
    ask: { method: "greet", parameter: "name" },
    methods: [
      {
        name: "greet",
        description: "Answer one question.",
        risk: "read",
        argv: ["greet"],
        parameters: [
          {
            name: "name",
            description: "Question to answer.",
            kind: "positional",
            type: "string",
            position: 0,
            required: true,
          },
        ],
        output: "text",
        evidenceId: "sub:greet",
        probe: { argv: ["greet", "--help"], expectExit: [0] },
      },
    ],
  };
  const evidence: EvidenceBundle = {
    schemaVersion: 1,
    requestedBinary: fixturePath,
    resolvedPath: fixturePath,
    probes: [],
  };
  await savePrimitive(root, manifest, evidence);
}

test("scoped ask delegates to a validated question entrypoint without calling Pi", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-question-entrypoint-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  let compileCalls = 0;
  try {
    await saveQuestionPrimitive(root);
    const exitCode = await runCli(
      ["ask", "demo", "archive question"],
      {
        env: { ...process.env, CMDMINT_HOME: root },
        stdout: (value: string) => stdout.push(value),
        stderr: (value: string) => stderr.push(value),
        interactive: false,
        compileAnswer: async () => {
          compileCalls += 1;
          throw new Error("Pi must not answer a delegated question");
        },
      },
    );

    assert.equal(exitCode, 0, stderr.join(""));
    assert.equal(stdout.join(""), "Hello, archive question!\n");
    assert.equal(compileCalls, 0);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped ask keeps delegated JSON output machine-clean", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-question-json-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    await saveQuestionPrimitive(root);
    assert.equal(
      await runCli(["ask", "demo", "archive question", "--json"], {
        env: { ...process.env, CMDMINT_HOME: root },
        stdout: (value: string) => stdout.push(value),
        stderr: (value: string) => stderr.push(value),
        interactive: true,
      }),
      0,
      stderr.join(""),
    );

    const result = JSON.parse(stdout.join(""));
    assert.equal(result.scope, "demo");
    assert.equal(result.delegated, true);
    assert.equal(result.answer, "Hello, archive question!");
    assert.deepEqual(result.invocation.argv, ["greet", "archive question"]);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped ask preview shows the delegated argv without executing or calling Pi", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-question-preview-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  let compileCalls = 0;
  try {
    await saveQuestionPrimitive(root);
    assert.equal(
      await runCli(
        ["ask", "demo", "archive question", "--show-prompt", "--json"],
        {
          env: { ...process.env, CMDMINT_HOME: root },
          stdout: (value: string) => stdout.push(value),
          stderr: (value: string) => stderr.push(value),
          compileAnswer: async () => {
            compileCalls += 1;
            throw new Error("Pi must not run during delegated preview");
          },
        },
      ),
      0,
      stderr.join(""),
    );

    const result = JSON.parse(stdout.join(""));
    assert.equal(result.delegated, true);
    assert.equal(result.prompt, null);
    assert.equal(result.invocation.executed, false);
    assert.deepEqual(result.invocation.argv, ["greet", "archive question"]);
    assert.equal(compileCalls, 0);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scoped delegated ask rejects cmdmint prompt tracing instead of silently ignoring it", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-question-trace-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    await saveQuestionPrimitive(root);
    assert.equal(
      await runCli(
        ["ask", "demo", "archive question", "--trace-prompts", join(root, "traces")],
        {
          env: { ...process.env, CMDMINT_HOME: root },
          stdout: (value: string) => stdout.push(value),
          stderr: (value: string) => stderr.push(value),
        },
      ),
      1,
    );
    assert.equal(stdout.join(""), "");
    assert.match(stderr.join(""), /does not use a cmdmint model prompt/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("learns, registers, discovers, and calls a CLI end to end", async () => {
  const cliModule = await import(
    new URL("../src/cli.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof cliModule?.runCli, "function");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-cli-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    env: {
      ...process.env,
      CMDMINT_HOME: root,
      CMDMINT_PI_BINARY: piDraftPath,
    },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  try {
    assert.equal(
      await cliModule!.runCli(
        ["learn", fixturePath, "--name", "demo", "--json"],
        io,
      ),
      0,
    );
    const learned = JSON.parse(stdout.join(""));
    assert.equal(learned.manifest.name, "demo");
    assert.equal(learned.verification.passed, true);

    stdout.length = 0;
    assert.equal(await cliModule!.runCli(["list", "--json"], io), 0);
    assert.deepEqual(
      JSON.parse(stdout.join("")).map((item: { name: string }) => item.name),
      ["demo"],
    );

    stdout.length = 0;
    assert.equal(
      await cliModule!.runCli(
        ["call", "demo.greet", "--args-json", '{"name":"Ada"}'],
        io,
      ),
      0,
    );
    assert.equal(stdout.join(""), "Hello, Ada!\n");
    assert.deepEqual(stderr, []);

    stdout.length = 0;
    io.env.CMDMINT_PI_BINARY = piSelectionPath;
    assert.equal(
      await cliModule!.runCli(
        ["use", "demo", "say hello to Grace", "--dry-run", "--json"],
        io,
      ),
      0,
    );
    const planned = JSON.parse(stdout.join(""));
    assert.deepEqual(planned.selection, {
      method: "greet",
      args: { name: "Grace" },
    });
    assert.equal(planned.invocation.executed, false);
    assert.deepEqual(planned.invocation.argv, ["greet", "Grace"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("learn --show-prompt prints the rendered prompt without calling Pi or saving", async () => {
  const { runCli } = await import("../src/cli.ts");
  const { listPrimitives } = await import("../src/registry.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-show-learn-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    const exitCode = await runCli(
      ["learn", fixturePath, "--name", "demo", "--show-prompt"],
      {
        env: {
          ...process.env,
          CMDMINT_HOME: root,
          CMDMINT_PI_BINARY: join(root, "missing-pi"),
        },
        stdout: (value: string) => stdout.push(value),
        stderr: (value: string) => stderr.push(value),
      },
    );

    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stdout.join(""), /^You compile CLI help into a small, stable primitive manifest\./);
    assert.match(stdout.join(""), /"requestedBinary":/);
    assert.match(stdout.join(""), /demo-cli greet <name>/);
    assert.deepEqual(await listPrimitives(root), []);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("use --show-prompt prints the rendered prompt without calling Pi or the learned CLI", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-show-use-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    env: {
      ...process.env,
      CMDMINT_HOME: root,
      CMDMINT_PI_BINARY: join(root, "missing-pi"),
    },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  const executionMarker = join(root, "learned-binary-executed");
  const previousMarker = process.env.CMDMINT_TEST_EXECUTION_MARKER;
  try {
    await saveDemoPrimitive(root);
    process.env.CMDMINT_TEST_EXECUTION_MARKER = executionMarker;
    const { runProcess } = await import("../src/process.ts");
    const control = await runProcess(fixturePath, ["greet", "Control"]);
    assert.equal(control.exitCode, 0);
    assert.equal(await readFile(executionMarker, "utf8"), "greet\n");
    await rm(executionMarker);

    const exitCode = await runCli(
      ["use", "demo", "say hello to Ada", "--show-prompt"],
      io,
    );

    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stdout.join(""), /^Choose exactly one method/);
    assert.match(stdout.join(""), /say hello to Ada/);
    assert.doesNotMatch(stdout.join(""), /Hello, Ada!/);
    await assert.rejects(readFile(executionMarker, "utf8"), {
      code: "ENOENT",
    });
  } finally {
    if (previousMarker === undefined) {
      delete process.env.CMDMINT_TEST_EXECUTION_MARKER;
    } else {
      process.env.CMDMINT_TEST_EXECUTION_MARKER = previousMarker;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects empty trace directories for every prompt-producing command", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-empty-trace-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    env: {
      ...process.env,
      CMDMINT_HOME: root,
      CMDMINT_PI_BINARY: join(root, "missing-pi"),
    },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  try {
    const cases = [
      ["learn", fixturePath, "--name", "demo", "--trace-prompts="],
      ["use", "demo", "say hello", "--trace-prompts="],
      ["ask", "cmdmint", "where is the registry?", "--trace-prompts="],
    ];
    for (const args of cases) {
      stdout.length = 0;
      stderr.length = 0;
      assert.equal(await runCli(args, io), 1);
      assert.equal(
        stderr.join(""),
        "cmdmint: --trace-prompts requires a non-empty value\n",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects show-prompt with every supplied trace directory spelling", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-exclusive-prompt-options-"));
  const traceDirectory = join(root, "traces");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    env: { ...process.env, CMDMINT_HOME: root },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  try {
    const commands = [
      ["learn", fixturePath, "--name", "demo"],
      ["use", "demo", "say hello"],
      ["ask", "cmdmint", "where is the registry?"],
    ];
    for (const command of commands) {
      for (const traceOption of [
        ["--trace-prompts", traceDirectory],
        ["--trace-prompts="],
      ]) {
        stdout.length = 0;
        stderr.length = 0;
        assert.equal(
          await runCli([...command, "--show-prompt", ...traceOption], io),
          1,
        );
        assert.equal(
          stderr.join(""),
          "cmdmint: --show-prompt cannot be combined with --trace-prompts\n",
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root help describes bounded captured Pi responses", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-captured-help-"));
  const stdout: string[] = [];
  try {
    assert.equal(
      await runCli(["--help"], {
        env: { ...process.env, CMDMINT_HOME: root },
        stdout: (value: string) => stdout.push(value),
        stderr: () => undefined,
      }),
      0,
    );
    assert.match(stdout.join(""), /captured Pi responses/);
    assert.match(stdout.join(""), /1 MiB/);
    assert.doesNotMatch(stdout.join(""), /raw Pi responses/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ask --show-prompt emits its exact source packet as JSON without calling Pi", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-show-ask-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  let compileCalls = 0;
  try {
    const exitCode = await runCli(
      ["ask", "cmdmint", "where is your registry?", "--show-prompt", "--json"],
      {
        env: { ...process.env, CMDMINT_HOME: root },
        stdout: (value: string) => stdout.push(value),
        stderr: (value: string) => stderr.push(value),
        compileAnswer: async () => {
          compileCalls += 1;
          throw new Error("Pi must not run during prompt preview");
        },
      },
    );

    assert.equal(exitCode, 0, stderr.join(""));
    const value = JSON.parse(stdout.join(""));
    assert.equal(value.scope, "cmdmint");
    assert.match(value.prompt, /^Answer a question using only the supplied cmdmint registry sources\./);
    assert.match(value.prompt, /"question":"where is your registry\?"/);
    assert.match(value.prompt, new RegExp(root.replaceAll("/", "\\/")));
    assert.equal(compileCalls, 0);
    assert.deepEqual(stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("--trace-prompts records actual learn, use, and ask model exchanges", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-trace-cli-"));
  const traceDirectory = join(root, "traces");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    env: {
      ...process.env,
      CMDMINT_HOME: root,
      CMDMINT_PI_BINARY: piDraftPath,
    },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  try {
    assert.equal(
      await runCli(
        [
          "learn",
          fixturePath,
          "--name",
          "demo",
          "--trace-prompts",
          traceDirectory,
          "--json",
        ],
        io,
      ),
      0,
      stderr.join(""),
    );

    stdout.length = 0;
    io.env.CMDMINT_PI_BINARY = piSelectionPath;
    assert.equal(
      await runCli(
        [
          "use",
          "demo",
          "say hello to Grace",
          "--dry-run",
          "--trace-prompts",
          traceDirectory,
          "--json",
        ],
        io,
      ),
      0,
      stderr.join(""),
    );

    stdout.length = 0;
    io.env.CMDMINT_PI_BINARY = piAnswerPath;
    assert.equal(
      await runCli(
        [
          "ask",
          "cmdmint",
          "where is your registry?",
          "--trace-prompts",
          traceDirectory,
          "--json",
        ],
        io,
      ),
      0,
      stderr.join(""),
    );

    const traces = await Promise.all(
      (await readdir(traceDirectory)).map(async (file) =>
        JSON.parse(await readFile(join(traceDirectory, file), "utf8")),
      ),
    );
    assert.equal(traces.length, 3);
    assert.ok(
      traces.some((trace) => trace.prompt.startsWith("You compile CLI help")),
    );
    assert.ok(
      traces.some((trace) => trace.prompt.startsWith("Choose exactly one method")),
    );
    assert.ok(
      traces.some((trace) => trace.prompt.startsWith("Answer a question using only")),
    );
    assert.ok(traces.every((trace) => typeof trace.response === "string"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("learning traces both a rejected candidate and its validation repair", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-repair-trace-"));
  const traceDirectory = join(root, "traces");
  const stdout: string[] = [];
  const stderr: string[] = [];
  try {
    assert.equal(
      await runCli(
        [
          "learn",
          fixturePath,
          "--name",
          "demo",
          "--trace-prompts",
          traceDirectory,
          "--json",
        ],
        {
          env: {
            ...process.env,
            CMDMINT_HOME: root,
            CMDMINT_PI_BINARY: piTraceContractPath,
          },
          stdout: (value: string) => stdout.push(value),
          stderr: (value: string) => stderr.push(value),
        },
      ),
      0,
      stderr.join(""),
    );
    const files = await readdir(traceDirectory);
    assert.equal(files.length, 2);
    const traces = await Promise.all(
      files.map(async (file) =>
        JSON.parse(await readFile(join(traceDirectory, file), "utf8")),
      ),
    );
    assert.equal(
      traces.filter((trace) =>
        trace.prompt.includes("Previous candidate failed deterministic validation"),
      ).length,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
