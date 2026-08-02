import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EvidenceBundle, PrimitiveManifest } from "../src/types.ts";

const manifest: PrimitiveManifest = {
  schemaVersion: 1,
  name: "demo",
  description: "Demonstrate a small learned CLI.",
  binary: {
    requested: "demo-cli",
    path: "/tmp/demo-cli",
    version: "demo-cli 1.0.0",
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
  ask: { method: "greet", parameter: "name" },
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

const evidence: EvidenceBundle = {
  schemaVersion: 1,
  requestedBinary: "demo-cli",
  resolvedPath: "/tmp/demo-cli",
  probes: [
    {
      id: "sub:greet",
      argv: ["greet", "--help"],
      exitCode: 0,
      stdout: "Usage: demo-cli greet <name>\nGreet one person.\n",
      stderr: "",
      timedOut: false,
      truncated: false,
    },
  ],
};

function ioFor(root: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      env: { ...process.env, CLIHOW_HOME: root },
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
    stdout,
    stderr,
  };
}

test("root help describes live learned primitives and handles an empty registry", async () => {
  const { runCli } = await import("../src/cli.ts");
  const { savePrimitive } = await import("../src/registry.ts");
  const root = await mkdtemp(join(tmpdir(), "clihow-help-"));
  try {
    const output = ioFor(root);
    assert.equal(await runCli(["--help"], output.io), 0);
    assert.match(output.stdout.join(""), /Learned primitives:\n\s+None yet\./);

    await savePrimitive(root, manifest, evidence);
    output.stdout.length = 0;
    assert.equal(await runCli(["--help"], output.io), 0);
    const help = output.stdout.join("");
    assert.match(help, /Learned primitives:\n\s+demo\s+1 method\b/);
    assert.match(help, /Scoped ask delegates to validated read-only question entrypoints/);
    assert.match(help, /clihow threads(?: --json)?/);
    assert.match(help, /--thread <id>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root help stays usable when registry manifests cannot be read", async () => {
  const { runCli } = await import("../src/cli.ts");
  const root = await mkdtemp(join(tmpdir(), "clihow-help-"));
  try {
    const directory = join(root, "primitives", "broken");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), "not json\n");
    const output = ioFor(root);

    assert.equal(await runCli(["--help"], output.io), 0);
    assert.match(output.stdout.join(""), /Usage:/);
    assert.match(output.stdout.join(""), /Learned primitives:\n\s+Unavailable\./);
    assert.deepEqual(output.stderr, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("primitive help has readable and JSON forms", async () => {
  const { runCli } = await import("../src/cli.ts");
  const { savePrimitive } = await import("../src/registry.ts");
  const root = await mkdtemp(join(tmpdir(), "clihow-help-"));
  try {
    await savePrimitive(root, manifest, evidence);
    const output = ioFor(root);

    assert.equal(await runCli(["help", "demo"], output.io), 0);
    const text = output.stdout.join("");
    assert.match(text, /demo - Demonstrate a small learned CLI\./);
    assert.match(text, /greet\s+\[read, text\]\s+Greet one person\./);
    assert.match(text, /name\s+string\s+required\s+Person to greet\./);
    assert.match(text, /clihow call demo\.greet/);
    assert.match(text, /Question entrypoint:\s+clihow ask demo <question>/);

    output.stdout.length = 0;
    assert.equal(await runCli(["help", "demo", "--json"], output.io), 0);
    const value = JSON.parse(output.stdout.join(""));
    assert.equal(value.name, "demo");
    assert.equal(value.methodCount, 1);
    assert.equal(value.methods[0].name, "greet");
    assert.equal(value.methods[0].parameters[0].name, "name");
    assert.deepEqual(value.ask, { method: "greet", parameter: "name" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
