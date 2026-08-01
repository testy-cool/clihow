export type Risk = "read" | "write" | "destructive";
export type OutputKind = "text" | "json" | "jsonl";
export type ParameterType = "string" | "integer" | "number" | "boolean" | "string[]";

export interface ProbeEvidence {
  id: string;
  argv: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface EvidenceBundle {
  schemaVersion: 1;
  requestedBinary: string;
  resolvedPath: string;
  probes: ProbeEvidence[];
}

interface ParameterBase {
  name: string;
  description: string;
  type: ParameterType;
  required: boolean;
  default?: string | number | boolean | string[];
  enum?: Array<string | number>;
}

export interface PositionalParameter extends ParameterBase {
  kind: "positional";
  position: number;
}

export interface OptionParameter extends ParameterBase {
  kind: "option";
  flag: string;
}

export type MethodParameter = PositionalParameter | OptionParameter;

export interface PrimitiveMethodDraft {
  name: string;
  description: string;
  risk: Risk;
  argv: string[];
  parameters: MethodParameter[];
  output: OutputKind;
  evidenceId: string;
}

export interface QuestionEntrypoint {
  method: string;
  parameter: string;
}

export interface PrimitiveDraft {
  description: string;
  ask?: QuestionEntrypoint;
  methods: PrimitiveMethodDraft[];
}

export interface BinaryIdentity {
  requested: string;
  path: string;
  version: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}

export interface PrimitiveMethod extends PrimitiveMethodDraft {
  probe: {
    argv: string[];
    expectExit: number[];
  };
}

export interface PrimitiveManifest {
  schemaVersion: 1;
  name: string;
  description: string;
  binary: BinaryIdentity;
  learnedAt: string;
  engine: {
    kind: "pi";
    provider: "openai-codex";
    model: "gpt-5.6-luna";
    thinking: "high";
  };
  ask?: QuestionEntrypoint;
  methods: PrimitiveMethod[];
}
