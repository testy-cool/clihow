import assert from "node:assert/strict";
import test from "node:test";

test("exports a bounded process runner", async () => {
  const processModule = await import(
    new URL("../src/process.ts", import.meta.url).href
  ).catch(() => undefined);

  assert.equal(typeof processModule?.runProcess, "function");
});

test("runs argv directly and captures separate output streams", async () => {
  const { runProcess } = await import("../src/process.ts");
  const literal = "$(touch /tmp/cmdmint-must-not-run);hello";

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
