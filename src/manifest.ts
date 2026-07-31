import type {
  BinaryIdentity,
  EvidenceBundle,
  PrimitiveDraft,
  PrimitiveManifest,
} from "./types.js";

interface MaterializeManifestInput {
  name: string;
  binary: BinaryIdentity;
  evidence: EvidenceBundle;
  learnedAt: string;
  draft: PrimitiveDraft;
}

export function materializeManifest(
  input: MaterializeManifestInput,
): PrimitiveManifest {
  const methods = input.draft.methods.map((method) => {
    const evidence = input.evidence.probes.find(
      (candidate) => candidate.id === method.evidenceId,
    );
    if (!evidence) {
      throw new Error(`Method ${method.name} cites unknown evidence ${method.evidenceId}`);
    }

    const evidencePrefix = evidence.argv.filter(
      (token) => token !== "--help" && token !== "-h",
    );
    for (const [index, token] of evidencePrefix.entries()) {
      if (method.argv[index] !== token) {
        throw new Error(
          `Method ${method.name} does not match the command in ${method.evidenceId}`,
        );
      }
    }
    const helpText = `${evidence.stdout}\n${evidence.stderr}`;
    for (const token of method.argv.slice(evidencePrefix.length)) {
      if (token.startsWith("-") && !helpText.includes(token)) {
        throw new Error(
          `Flag ${token} is not present in ${method.evidenceId} help evidence`,
        );
      }
    }
    for (const parameter of method.parameters) {
      if (
        parameter.kind === "option" &&
        !helpText.includes(parameter.flag)
      ) {
        throw new Error(
          `Flag ${parameter.flag} is not present in ${method.evidenceId} help evidence`,
        );
      }
    }

    return {
      ...method,
      probe: {
        argv: [...evidence.argv],
        expectExit: evidence.exitCode === null ? [0] : [evidence.exitCode],
      },
    };
  });

  return {
    schemaVersion: 1,
    name: input.name,
    description: input.draft.description,
    binary: input.binary,
    learnedAt: input.learnedAt,
    engine: {
      kind: "pi",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      thinking: "high",
    },
    methods,
  };
}
