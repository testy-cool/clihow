import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
      CMDMINT_PI_BINARY: piDraftPath,
    },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  try {
    assert.equal(
      await runCli(["learn", fixturePath, "--name", "demo", "--json"], io),
      0,
      stderr.join(""),
    );
    stdout.length = 0;
    io.env.CMDMINT_PI_BINARY = join(root, "missing-pi");

    const exitCode = await runCli(
      ["use", "demo", "say hello to Ada", "--show-prompt"],
      io,
    );

    assert.equal(exitCode, 0, stderr.join(""));
    assert.match(stdout.join(""), /^Choose exactly one method/);
    assert.match(stdout.join(""), /say hello to Ada/);
    assert.doesNotMatch(stdout.join(""), /HELLO, ADA!/);
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
