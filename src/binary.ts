import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { BinaryIdentity } from "./types.js";

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolveHash, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolveHash);
  });
  return hash.digest("hex");
}

export async function assertBinaryUnchanged(
  binary: BinaryIdentity,
  primitiveName: string,
): Promise<void> {
  if ((await sha256File(binary.path)) !== binary.sha256) {
    throw new Error(
      `Binary drift detected for ${primitiveName}; run clihow learn again`,
    );
  }
}
