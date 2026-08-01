import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const recorderPath = fileURLToPath(
  new URL("../fixtures/pi-recorder.mjs", import.meta.url),
);
const traceContractPath = fileURLToPath(
  new URL("../fixtures/pi-trace-contract.mjs", import.meta.url),
);

test("runs Luna High through Pi without tools or ambient agent context", async () => {
  const piModule = await import(
    new URL("../src/pi.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof piModule?.compileWithPi, "function");

  const output = await piModule!.compileWithPi("compile this CLI", {
    piBinary: recorderPath,
  });

  assert.deepEqual(JSON.parse(output), [
    "--provider",
    "openai-codex",
    "--model",
    "gpt-5.6-luna",
    "--thinking",
    "high",
    "--print",
    "--no-session",
    "--no-tools",
    "--no-context-files",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "compile this CLI",
  ]);
});

test("records the exact prompt and captured response with private POSIX modes", {
  skip: process.platform === "win32",
}, async () => {
  const { compileWithPi } = await import("../src/pi.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-pi-trace-"));
  const directory = join(root, "created-traces");
  try {
    const output = await compileWithPi("trace this exact prompt", {
      piBinary: recorderPath,
      traceDirectory: directory,
    });

    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0] ?? "", /\.json$/);
    const trace = JSON.parse(
      await readFile(join(directory, files[0]!), "utf8"),
    );
    assert.equal(trace.engine.model, "gpt-5.6-luna");
    assert.equal(trace.engine.thinking, "high");
    assert.equal(trace.prompt, "trace this exact prompt");
    assert.equal(trace.response, output);
    assert.equal(trace.exitCode, 0);
    assert.equal(trace.timedOut, false);
    assert.equal(trace.truncated, false);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, files[0]!))).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("caps captured Pi stdout and stderr at 1 MiB and traces truncation", async () => {
  const { compileWithPi } = await import("../src/pi.ts");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-pi-capture-limit-"));
  const directory = join(root, "traces");
  try {
    const output = await compileWithPi("emit oversized capture", {
      piBinary: traceContractPath,
      traceDirectory: directory,
    });

    assert.equal(Buffer.byteLength(output), 1024 * 1024);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const trace = JSON.parse(
      await readFile(join(directory, files[0]!), "utf8"),
    );
    assert.equal(Buffer.byteLength(trace.response), 1024 * 1024);
    assert.equal(Buffer.byteLength(trace.stderr), 1024 * 1024);
    assert.equal(trace.truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
