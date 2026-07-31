import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixturePath = fileURLToPath(
  new URL("../fixtures/demo-cli.mjs", import.meta.url),
);
const piDraftPath = fileURLToPath(
  new URL("../fixtures/pi-draft.mjs", import.meta.url),
);

test("learns a grounded manifest from bounded CLI help probes", async () => {
  const learnerModule = await import(
    new URL("../src/learner.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof learnerModule?.learnPrimitive, "function");
  let receivedPrompt = "";

  const result = await learnerModule!.learnPrimitive({
    binary: fixturePath,
    name: "demo",
    now: () => new Date("2026-07-31T12:00:00.000Z"),
    compileDraft: async (prompt: string) => {
      receivedPrompt = prompt;
      return JSON.stringify({
        description: "A deterministic demonstration CLI.",
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
          },
        ],
      });
    },
  });

  assert.deepEqual(
    result.evidence.probes.map((probe: { id: string }) => probe.id),
    ["root", "sub:greet", "sub:add", "sub:status"],
  );
  assert.equal(result.manifest.binary.version, "demo-cli 1.0.0");
  assert.match(result.manifest.binary.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.methods[0]?.name, "greet");
  assert.match(receivedPrompt, /UNTRUSTED DATA/);
  assert.match(receivedPrompt, /demo-cli greet <name>/);
  assert.match(
    receivedPrompt,
    /For root evidence, argv must not contain the executable name/,
  );
});

test("uses the locked Pi runtime when no compiler is injected", async () => {
  const { learnPrimitive } = await import("../src/learner.ts");

  const result = await learnPrimitive({
    binary: fixturePath,
    name: "demo",
    piBinary: piDraftPath,
  });

  assert.equal(result.manifest.engine.provider, "openai-codex");
  assert.equal(result.manifest.engine.model, "gpt-5.6-luna");
  assert.equal(result.manifest.engine.thinking, "high");
  assert.equal(result.manifest.methods[0]?.name, "greet");
});

test("repairs one manifest that fails deterministic validation", async () => {
  const { learnPrimitive } = await import("../src/learner.ts");
  const prompts: string[] = [];

  const result = await learnPrimitive({
    binary: fixturePath,
    name: "demo",
    compileDraft: async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return JSON.stringify({
          description: "Demo CLI.",
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
        });
      }
      return JSON.stringify({
        description: "Demo CLI.",
        methods: [
          {
            name: "greet",
            description: "Greet one person.",
            risk: "read",
            argv: ["greet"],
            parameters: [],
            output: "text",
            evidenceId: "sub:greet",
          },
        ],
      });
    },
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /Previous candidate failed deterministic validation/);
  assert.match(prompts[1] ?? "", /must not include executable demo-cli/);
  assert.equal(result.manifest.methods[0]?.name, "greet");
});
