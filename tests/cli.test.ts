import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixturePath = fileURLToPath(
  new URL("../fixtures/demo-cli.mjs", import.meta.url),
);
const piDraftPath = fileURLToPath(
  new URL("../fixtures/pi-draft.mjs", import.meta.url),
);
const piSelectionPath = fileURLToPath(
  new URL("../fixtures/pi-selection.mjs", import.meta.url),
);

test("learns, registers, discovers, and calls a CLI end to end", async () => {
  const cliModule = await import(
    new URL("../src/cli.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof cliModule?.runCli, "function");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-cli-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    env: {
      ...process.env,
      CMDMINT_HOME: root,
      CMDMINT_PI_BINARY: piDraftPath,
    },
    stdout: (value: string) => stdout.push(value),
    stderr: (value: string) => stderr.push(value),
  };
  try {
    assert.equal(
      await cliModule!.runCli(
        ["learn", fixturePath, "--name", "demo", "--json"],
        io,
      ),
      0,
    );
    const learned = JSON.parse(stdout.join(""));
    assert.equal(learned.manifest.name, "demo");
    assert.equal(learned.verification.passed, true);

    stdout.length = 0;
    assert.equal(await cliModule!.runCli(["list", "--json"], io), 0);
    assert.deepEqual(
      JSON.parse(stdout.join("")).map((item: { name: string }) => item.name),
      ["demo"],
    );

    stdout.length = 0;
    assert.equal(
      await cliModule!.runCli(
        ["call", "demo.greet", "--args-json", '{"name":"Ada"}'],
        io,
      ),
      0,
    );
    assert.equal(stdout.join(""), "Hello, Ada!\n");
    assert.deepEqual(stderr, []);

    stdout.length = 0;
    io.env.CMDMINT_PI_BINARY = piSelectionPath;
    assert.equal(
      await cliModule!.runCli(
        ["use", "demo", "say hello to Grace", "--dry-run", "--json"],
        io,
      ),
      0,
    );
    const planned = JSON.parse(stdout.join(""));
    assert.deepEqual(planned.selection, {
      method: "greet",
      args: { name: "Grace" },
    });
    assert.equal(planned.invocation.executed, false);
    assert.deepEqual(planned.invocation.argv, ["greet", "Grace"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
