import assert from "node:assert/strict";
import test from "node:test";
import type { PrimitiveManifest } from "../src/types.ts";

const manifest: PrimitiveManifest = {
  schemaVersion: 1,
  name: "demo",
  description: "Demo primitive.",
  binary: {
    requested: "demo-cli",
    path: "/tmp/demo-cli",
    version: "1.0.0",
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
      parameters: [
        {
          name: "name",
          description: "Person to greet.",
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

test("selects and validates one learned method for a natural-language intent", async () => {
  const selectorModule = await import(
    new URL("../src/selector.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof selectorModule?.selectMethod, "function");
  let prompt = "";

  const selection = await selectorModule!.selectMethod(
    manifest,
    "say hello to Ada",
    {
      compileSelection: async (value: string) => {
        prompt = value;
        return JSON.stringify({ method: "greet", args: { name: "Ada" } });
      },
    },
  );

  assert.deepEqual(selection, { method: "greet", args: { name: "Ada" } });
  assert.match(prompt, /Choose exactly one method/);
  assert.match(prompt, /say hello to Ada/);
});
