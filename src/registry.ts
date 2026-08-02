import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { EvidenceBundle, PrimitiveManifest } from "./types.js";

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export function registryHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLIHOW_HOME ?? join(homedir(), ".local", "share", "clihow");
}

function primitiveDirectory(root: string, name: string): string {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid primitive name: ${name}`);
  }
  return join(root, "primitives", name);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

export async function savePrimitive(
  root: string,
  manifest: PrimitiveManifest,
  evidence: EvidenceBundle,
): Promise<void> {
  const directory = primitiveDirectory(root, manifest.name);
  await writeJsonAtomic(join(directory, "evidence.json"), evidence);
  await writeJsonAtomic(join(directory, "manifest.json"), manifest);
}

export async function loadPrimitive(
  root: string,
  name: string,
): Promise<PrimitiveManifest> {
  const path = join(primitiveDirectory(root, name), "manifest.json");
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as PrimitiveManifest;
}

export async function loadEvidence(
  root: string,
  name: string,
): Promise<EvidenceBundle> {
  const path = join(primitiveDirectory(root, name), "evidence.json");
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as EvidenceBundle;
}

export async function listPrimitives(root: string): Promise<PrimitiveManifest[]> {
  let entries;
  try {
    entries = await readdir(join(root, "primitives"), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const names = entries
    .filter((entry) => entry.isDirectory() && NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  return await Promise.all(names.map(async (name) => await loadPrimitive(root, name)));
}
