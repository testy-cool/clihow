import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAnswerPrompt } from "../src/answer.ts";
import { runCli } from "../src/cli.ts";
import { registryHome } from "../src/registry.ts";
import { createThread, recordExchange } from "../src/threads.ts";

test("publishes only the clihow command and storage contract", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(packageJson.name, "clihow");
  assert.deepEqual(packageJson.bin, { clihow: "./dist/cli.js" });

  assert.equal(
    registryHome({ CLIHOW_HOME: "/tmp/clihow-home" }),
    "/tmp/clihow-home",
  );
  assert.match(registryHome({}), /\.local\/share\/clihow$/);

  const stdout: string[] = [];
  const stderr: string[] = [];
  assert.equal(
    await runCli(["--help"], {
      env: { CLIHOW_HOME: "/tmp/clihow-help" },
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    }),
    0,
  );
  assert.match(stdout.join(""), /^clihow /);
  assert.deepEqual(stderr, []);
});

test("uses clihow identity in grounded prompts and durable thread records", async () => {
  const prompt = buildAnswerPrompt(
    "Where do you keep your data?",
    [],
    "clihow",
    { version: "0.1.0", registryRoot: "/tmp/clihow-home" },
  );
  assert.match(prompt, /clihow:runtime/);
  assert.match(prompt, /CLIHOW_HOME/);

  const root = await mkdtemp(join(tmpdir(), "clihow-branding-"));
  try {
    const thread = await createThread(root, {
      scope: "clihow",
      cwd: "/work/demo",
      question: "Where is the registry?",
    });
    await recordExchange(root, thread, {
      question: "Where is the registry?",
      answer: "At /tmp/clihow-home.",
      sources: ["clihow:runtime"],
    });
    const firstRecord = JSON.parse(
      (await readFile(join(root, "threads", `${thread.id}.jsonl`), "utf8")).split("\n")[0],
    );
    assert.equal(firstRecord.type, "clihow_thread");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
