import assert from "node:assert/strict";
import test from "node:test";
import type { PrimitiveMethod } from "../src/types.ts";

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
