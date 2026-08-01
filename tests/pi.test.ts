import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const recorderPath = fileURLToPath(
  new URL("../fixtures/pi-recorder.mjs", import.meta.url),
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

test("records the exact prompt and raw response when tracing is explicitly enabled", async () => {
  const { compileWithPi } = await import("../src/pi.ts");
  const directory = await mkdtemp(join(tmpdir(), "cmdmint-pi-trace-"));
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
