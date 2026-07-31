import assert from "node:assert/strict";
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
