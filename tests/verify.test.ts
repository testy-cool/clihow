import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { PrimitiveManifest } from "../src/types.ts";

const fixturePath = fileURLToPath(
  new URL("../fixtures/demo-cli.mjs", import.meta.url),
);

test("runs each method's non-mutating verification probe", async () => {
  const verifyModule = await import(
    new URL("../src/verify.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof verifyModule?.testPrimitive, "function");
  const contents = await readFile(fixturePath);
  const metadata = await stat(fixturePath);
  const manifest: PrimitiveManifest = {
    schemaVersion: 1,
    name: "demo",
    description: "Demo primitive.",
    binary: {
      requested: "demo-cli",
      path: fixturePath,
      version: "demo-cli 1.0.0",
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
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

  const report = await verifyModule!.testPrimitive(manifest, {
    now: () => new Date("2026-07-31T12:00:00.000Z"),
  });

  assert.equal(report.passed, true);
  assert.equal(report.testedAt, "2026-07-31T12:00:00.000Z");
  assert.deepEqual(report.methods[0]?.argv, ["greet", "--help"]);
  assert.equal(report.methods[0]?.exitCode, 0);
});

test("refuses to verify a primitive after binary drift", async () => {
  const { testPrimitive } = await import("../src/verify.ts");
  const metadata = await stat(fixturePath);
  const manifest: PrimitiveManifest = {
    schemaVersion: 1,
    name: "demo",
    description: "Demo primitive.",
    binary: {
      requested: "demo-cli",
      path: fixturePath,
      version: "demo-cli 1.0.0",
      sha256: "0".repeat(64),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    },
    learnedAt: "2026-07-31T12:00:00.000Z",
    engine: {
      kind: "pi",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      thinking: "high",
    },
    methods: [],
  };

  await assert.rejects(testPrimitive(manifest), /Binary drift detected/);
});
