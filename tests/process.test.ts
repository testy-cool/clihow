import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("exports a bounded process runner", async () => {
  const processModule = await import(
    new URL("../src/process.ts", import.meta.url).href
  ).catch(() => undefined);

  assert.equal(typeof processModule?.runProcess, "function");
});

test("runs argv directly and captures separate output streams", async () => {
  const { runProcess } = await import("../src/process.ts");
  const literal = "$(touch /tmp/clihow-must-not-run);hello";

  const result = await runProcess(process.execPath, [
    "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write('warning');",
    literal,
  ]);

  assert.equal(result.stdout, literal);
  assert.equal(result.stderr, "warning");
  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
});

test("kills a process after its timeout", async () => {
  const { runProcess } = await import("../src/process.ts");

  const result = await runProcess(
    process.execPath,
    ["-e", "setTimeout(() => {}, 200)"],
    { timeoutMs: 20 },
  );

  assert.equal(result.timedOut, true);
  assert.ok(result.durationMs < 180);
});

test("truncates captured output at the configured byte limit", async () => {
  const { runProcess } = await import("../src/process.ts");

  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('a'.repeat(100)); process.stderr.write('b'.repeat(100));",
    ],
    { maxOutputBytes: 16 },
  );

  assert.equal(Buffer.byteLength(result.stdout), 16);
  assert.equal(Buffer.byteLength(result.stderr), 16);
  assert.equal(result.truncated, true);
});

test("runs inside the supplied directory and environment", async () => {
  const { runProcess } = await import("../src/process.ts");
  const cwd = await mkdtemp(join(tmpdir(), "clihow-process-"));
  try {
    const result = await runProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify({cwd: process.cwd(), value: process.env.CLIHOW_TEST_VALUE}))",
      ],
      {
        cwd,
        env: { PATH: process.env.PATH ?? "", CLIHOW_TEST_VALUE: "isolated" },
      },
    );

    assert.deepEqual(JSON.parse(result.stdout), { cwd, value: "isolated" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

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
