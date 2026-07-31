import assert from "node:assert/strict";
import test from "node:test";

const evidence = {
  schemaVersion: 1 as const,
  requestedBinary: "demo-cli",
  resolvedPath: "/tmp/demo-cli",
  probes: [
    {
      id: "root",
      argv: ["--help"],
      exitCode: 0,
      stdout: "Commands:\n  greet  Greet someone\n",
      stderr: "",
      timedOut: false,
      truncated: false,
    },
    {
      id: "sub:greet",
      argv: ["greet", "--help"],
      exitCode: 0,
      stdout: "Usage: demo-cli greet <name> [--loud]\n  --loud  Uppercase output\n",
      stderr: "",
      timedOut: false,
      truncated: false,
    },
  ],
};

const binary = {
  requested: "demo-cli",
  path: "/tmp/demo-cli",
  version: "demo-cli 1.0.0",
  sha256: "a".repeat(64),
  size: 123,
  mtimeMs: 456,
};

test("materializes model output through known help evidence", async () => {
  const manifestModule = await import(
    new URL("../src/manifest.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof manifestModule?.materializeManifest, "function");

  const manifest = manifestModule!.materializeManifest({
    name: "demo",
    binary,
    evidence,
    learnedAt: "2026-07-31T12:00:00.000Z",
    draft: {
      description: "A harmless demonstration CLI.",
      methods: [
        {
          name: "greet",
          description: "Greet one person.",
          risk: "read",
          argv: ["greet"],
          parameters: [
            {
              name: "name",
              kind: "positional",
              type: "string",
              position: 0,
              required: true,
              description: "Person to greet.",
            },
            {
              name: "loud",
              kind: "option",
              type: "boolean",
              flag: "--loud",
              required: false,
              description: "Uppercase the greeting.",
            },
          ],
          output: "text",
          evidenceId: "sub:greet",
        },
      ],
    },
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.engine, {
    kind: "pi",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    thinking: "high",
  });
  assert.deepEqual(manifest.methods[0]?.probe, {
    argv: ["greet", "--help"],
    expectExit: [0],
  });
});

test("rejects a model-invented flag absent from its cited help", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");

  assert.throws(
    () =>
      materializeManifest({
        name: "demo",
        binary,
        evidence,
        learnedAt: "2026-07-31T12:00:00.000Z",
        draft: {
          description: "A harmless demonstration CLI.",
          methods: [
            {
              name: "greet",
              description: "Greet one person.",
              risk: "read",
              argv: ["greet", "--delete-everything"],
              parameters: [],
              output: "text",
              evidenceId: "sub:greet",
            },
          ],
        },
      }),
    /--delete-everything.*not present in sub:greet/,
  );
});

test("rejects a model-invented option parameter", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");

  assert.throws(
    () =>
      materializeManifest({
        name: "demo",
        binary,
        evidence,
        learnedAt: "2026-07-31T12:00:00.000Z",
        draft: {
          description: "A harmless demonstration CLI.",
          methods: [
            {
              name: "greet",
              description: "Greet one person.",
              risk: "read",
              argv: ["greet"],
              parameters: [
                {
                  name: "erase",
                  kind: "option",
                  type: "boolean",
                  flag: "--erase",
                  required: false,
                  description: "Invented by the model.",
                },
              ],
              output: "text",
              evidenceId: "sub:greet",
            },
          ],
        },
      }),
    /--erase.*not present in sub:greet/,
  );
});

test("rejects structurally invalid model output", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");

  assert.throws(
    () =>
      materializeManifest({
        name: "demo",
        binary,
        evidence,
        learnedAt: "2026-07-31T12:00:00.000Z",
        draft: {
          description: "A harmless demonstration CLI.",
          methods: [
            {
              name: "greet",
              description: "Greet one person.",
              risk: "omniscient",
              argv: ["greet"],
              parameters: [],
              output: "text",
              evidenceId: "sub:greet",
            },
          ],
        } as never,
      }),
    /risk must be read, write, or destructive/,
  );
});

test("escalates obviously destructive commands despite a model misclassification", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");
  const manifest = materializeManifest({
    name: "demo",
    binary,
    evidence: {
      ...evidence,
      probes: [
        ...evidence.probes,
        {
          id: "sub:delete",
          argv: ["delete", "--help"],
          exitCode: 0,
          stdout: "Usage: demo-cli delete <resource>\n",
          stderr: "",
          timedOut: false,
          truncated: false,
        },
      ],
    },
    learnedAt: "2026-07-31T12:00:00.000Z",
    draft: {
      description: "A demonstration CLI.",
      methods: [
        {
          name: "resource.delete",
          description: "Delete a resource permanently.",
          risk: "read",
          argv: ["delete"],
          parameters: [],
          output: "text",
          evidenceId: "sub:delete",
        },
      ],
    },
  });

  assert.equal(manifest.methods[0]?.risk, "destructive");
});
