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

test("rejects an option flag duplicated between fixed argv and a parameter", async () => {
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
              argv: ["greet", "--loud"],
              parameters: [
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
      }),
    /Option flag --loud.*both fixed argv and parameter/i,
  );
});

test("materializes a validated read-only question entrypoint", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");
  const manifest = materializeManifest({
    name: "demo",
    binary,
    evidence,
    learnedAt: "2026-07-31T12:00:00.000Z",
    draft: {
      description: "A harmless demonstration CLI.",
      ask: { method: "greet", parameter: "name" },
      methods: [
        {
          name: "greet",
          description: "Answer a question with a greeting.",
          risk: "read",
          argv: ["greet"],
          parameters: [
            {
              name: "name",
              kind: "positional",
              type: "string",
              position: 0,
              required: true,
              description: "Question to answer.",
            },
          ],
          output: "text",
          evidenceId: "sub:greet",
        },
      ],
    },
  });

  assert.deepEqual(manifest.ask, { method: "greet", parameter: "name" });
});

test("rejects an unsafe or ambiguous question entrypoint", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");
  const draft = {
    description: "A demonstration CLI.",
    ask: { method: "greet", parameter: "name" },
    methods: [
      {
        name: "greet",
        description: "Answer a question with a greeting.",
        risk: "write",
        argv: ["greet"],
        parameters: [
          {
            name: "name",
            kind: "positional",
            type: "string",
            position: 0,
            required: true,
            description: "Question to answer.",
          },
        ],
        output: "text",
        evidenceId: "sub:greet",
      },
    ],
  };

  assert.throws(
    () =>
      materializeManifest({
        name: "demo",
        binary,
        evidence,
        learnedAt: "2026-07-31T12:00:00.000Z",
        draft,
      }),
    /question entrypoint.*read-only/i,
  );

  assert.throws(
    () =>
      materializeManifest({
        name: "demo",
        binary,
        evidence,
        learnedAt: "2026-07-31T12:00:00.000Z",
        draft: {
          ...draft,
          methods: [
            {
              ...draft.methods[0],
              risk: "read",
              parameters: [
                ...draft.methods[0].parameters,
                {
                  name: "loud",
                  kind: "option",
                  type: "boolean",
                  flag: "--loud",
                  required: false,
                  description: "Uppercase the answer.",
                },
              ],
            },
          ],
        },
      }),
    /question entrypoint method must have exactly one parameter/i,
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

test("rejects the executable name inside a root-level argv", async () => {
  const { materializeManifest } = await import("../src/manifest.ts");

  assert.throws(
    () =>
      materializeManifest({
        name: "demo",
        binary,
        evidence: {
          ...evidence,
          probes: evidence.probes.map((probe) =>
            probe.id === "root"
              ? { ...probe, stdout: "Usage: demo-cli [options]\n" }
              : probe,
          ),
        },
        learnedAt: "2026-07-31T12:00:00.000Z",
        draft: {
          description: "A demonstration CLI.",
          methods: [
            {
              name: "root",
              description: "Run the root operation.",
              risk: "read",
              argv: ["demo-cli"],
              parameters: [],
              output: "text",
              evidenceId: "root",
            },
          ],
        },
      }),
    /Root method root must not include executable demo-cli in argv/,
  );
});
