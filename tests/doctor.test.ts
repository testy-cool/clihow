import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const piDoctorPath = fileURLToPath(
  new URL("../fixtures/pi-doctor.mjs", import.meta.url),
);

test("checks Pi, Luna, and the local primitive registry", async () => {
  const doctorModule = await import(
    new URL("../src/doctor.ts", import.meta.url).href
  ).catch(() => undefined);
  assert.equal(typeof doctorModule?.runDoctor, "function");
  const root = await mkdtemp(join(tmpdir(), "cmdmint-doctor-"));
  try {
    const report = await doctorModule!.runDoctor({
      piBinary: piDoctorPath,
      registryRoot: root,
    });

    assert.equal(report.ok, true);
    assert.deepEqual(
      report.checks.map((check: { name: string }) => check.name),
      ["pi", "model", "registry"],
    );
    assert.match(report.checks[1]?.detail ?? "", /gpt-5\.6-luna/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
