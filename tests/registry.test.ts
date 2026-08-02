import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EvidenceBundle, PrimitiveManifest } from "../src/types.ts";

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
  methods: [],
};

const evidence: EvidenceBundle = {
  schemaVersion: 1,
  requestedBinary: "demo-cli",
  resolvedPath: "/tmp/demo-cli",
  probes: [],
};

test("stores and reloads a primitive with its evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "clihow-registry-"));
  try {
    const registryModule = await import(
      new URL("../src/registry.ts", import.meta.url).href
    ).catch(() => undefined);
    assert.equal(typeof registryModule?.savePrimitive, "function");

    await registryModule!.savePrimitive(root, manifest, evidence);

    assert.deepEqual(await registryModule!.loadPrimitive(root, "demo"), manifest);
    assert.deepEqual(await readdir(join(root, "primitives", "demo")), [
      "evidence.json",
      "manifest.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lists primitive manifests in stable name order", async () => {
  const root = await mkdtemp(join(tmpdir(), "clihow-registry-"));
  try {
    const { listPrimitives, savePrimitive } = await import("../src/registry.ts");
    await savePrimitive(root, manifest, evidence);
    await savePrimitive(
      root,
      { ...manifest, name: "alpha", description: "First primitive." },
      evidence,
    );

    const primitives = await listPrimitives(root);

    assert.deepEqual(
      primitives.map((primitive) => primitive.name),
      ["alpha", "demo"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
