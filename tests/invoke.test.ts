import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { PrimitiveManifest, PrimitiveMethod } from "../src/types.ts";

const fixturePath = fileURLToPath(
  new URL("../fixtures/demo-cli.mjs", import.meta.url),
);

const greetMethod: PrimitiveMethod = {
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
    {
      name: "loud",
      description: "Uppercase the greeting.",
      kind: "option",
      type: "boolean",
      flag: "--loud",
      required: false,
    },
  ],
  output: "text",
  evidenceId: "sub:greet",
  probe: { argv: ["greet", "--help"], expectExit: [0] },
};

async function fixtureManifest(
  method: PrimitiveMethod = greetMethod,
  binaryPath = fixturePath,
): Promise<PrimitiveManifest> {
  const contents = await readFile(binaryPath);
  const metadata = await stat(binaryPath);
  return {
    schemaVersion: 1,
    name: "demo",
    description: "Demo primitive.",
    binary: {
      requested: "demo-cli",
      path: binaryPath,
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
    methods: [method],
  };
}

test("binds validated arguments without creating a shell command", async () => {
  const invokeModule = await import(
    new URL("../src/invoke.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof invokeModule?.buildMethodArgv, "function");

  const argv = invokeModule!.buildMethodArgv(greetMethod, {
    name: "$(touch /tmp/cmdmint-never)",
    loud: true,
  });

  assert.deepEqual(argv, [
    "greet",
    "$(touch /tmp/cmdmint-never)",
    "--loud",
  ]);
});

test("binds numeric options and repeated string options", async () => {
  const { buildMethodArgv } = await import("../src/invoke.ts");
  const method: PrimitiveMethod = {
    ...greetMethod,
    name: "search",
    argv: ["search"],
    parameters: [
      {
        name: "query",
        description: "Search query.",
        kind: "positional",
        type: "string",
        position: 0,
        required: true,
      },
      {
        name: "limit",
        description: "Maximum results.",
        kind: "option",
        type: "integer",
        flag: "--limit",
        required: false,
        default: 10,
      },
      {
        name: "tag",
        description: "Tag filters.",
        kind: "option",
        type: "string[]",
        flag: "--tag",
        required: false,
      },
    ],
  };

  assert.deepEqual(
    buildMethodArgv(method, { query: "tools", limit: 3, tag: ["cli", "ai"] }),
    ["search", "tools", "--limit", "3", "--tag", "cli", "--tag", "ai"],
  );
});

test("rejects arguments not declared by the learned method", async () => {
  const { buildMethodArgv } = await import("../src/invoke.ts");

  assert.throws(
    () => buildMethodArgv(greetMethod, { name: "Ada", shell: "rm -rf" }),
    /Unknown argument: shell/,
  );
});

test("executes a learned method through its exact binary and argv", async () => {
  const { executeMethod } = await import("../src/invoke.ts");
  const manifest = await fixtureManifest();

  const result = await executeMethod(manifest, "greet", { name: "Ada" });

  assert.equal(result.executed, true);
  assert.deepEqual(result.argv, ["greet", "Ada"]);
  assert.equal(result.stdout, "Hello, Ada!\n");
  assert.equal(result.exitCode, 0);
});

test("refuses a state-changing method without explicit approval", async () => {
  const { executeMethod } = await import("../src/invoke.ts");
  const manifest = await fixtureManifest({ ...greetMethod, risk: "write" });

  await assert.rejects(
    executeMethod(manifest, "greet", { name: "Ada" }),
    /is write; pass --yes to execute it/,
  );
});

test("refuses execution after the learned binary changes", async () => {
  const { executeMethod } = await import("../src/invoke.ts");
  const manifest = await fixtureManifest();
  manifest.binary.sha256 = "0".repeat(64);

  await assert.rejects(
    executeMethod(manifest, "greet", { name: "Ada" }),
    /Binary drift detected.*run cmdmint learn again/,
  );
});

test("forwards invocation environment and tee callbacks without a shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "cmdmint-invoke-"));
  const binaryPath = join(root, "echo-env.mjs");
  try {
    await writeFile(
      binaryPath,
      "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({value: process.env.CMDMINT_TEST_VALUE, arg: process.argv[2]})); process.stderr.write('live-warning');\n",
      { encoding: "utf8", mode: 0o700 },
    );
    await chmod(binaryPath, 0o700);
    const method: PrimitiveMethod = {
      ...greetMethod,
      name: "echo",
      argv: [],
      parameters: [
        {
          name: "value",
          description: "Value to echo.",
          kind: "positional",
          type: "string",
          position: 0,
          required: true,
        },
      ],
    };
    const manifest = await fixtureManifest(method, binaryPath);
    const liveStdout: string[] = [];
    const liveStderr: string[] = [];

    const { executeMethod } = await import("../src/invoke.ts");
    const result = await executeMethod(
      manifest,
      "echo",
      { value: "$(touch /tmp/cmdmint-invoke-must-not-run)" },
      {
        stdio: "tee",
        env: { PATH: process.env.PATH ?? "", CMDMINT_TEST_VALUE: "isolated" },
        onStdout: (value) => liveStdout.push(value),
        onStderr: (value) => liveStderr.push(value),
      },
    );

    assert.deepEqual(JSON.parse(result.stdout), {
      value: "isolated",
      arg: "$(touch /tmp/cmdmint-invoke-must-not-run)",
    });
    assert.equal(result.stderr, "live-warning");
    assert.equal(liveStdout.join(""), result.stdout);
    assert.equal(liveStderr.join(""), result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
