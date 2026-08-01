# cmdmint

Mint an installed CLI into a tested, agent-discoverable primitive.

```bash
cmdmint learn gh
cmdmint help gh
cmdmint ask gh "How do I list repositories?" --json
cmdmint call gh.repo_list --args-json '{"limit":10}' --dry-run --json
```

`cmdmint` inspects bounded help/version output, asks Pi to compile a small method manifest, validates every command and option against the captured evidence, and stores the result locally. Calls later execute the original binary directly with an argv array—never through a shell.

## Why this exists

Agents should not have to rediscover a CLI, remember its provider/model setup, or improvise command strings on every run. A learned primitive gives them one stable surface:

```text
installed CLI -> bounded evidence -> compiled manifest -> validated argv -> exact CLI
                                      ^          ^
                                      |          +-- ask grounded questions
                                      +-- discover with help/list/describe
```

The model is used only for compilation, natural-language method selection, and grounded answers over stored registry evidence. Probing, validation, storage, drift detection, approval gates, testing, and execution are deterministic.

## Install locally

Requirements:

- Node.js 22 or newer
- pnpm
- Pi available as `pi`
- Pi access to `openai-codex/gpt-5.6-luna`

```bash
pnpm install
pnpm build
pnpm link --global
cmdmint doctor
```

## Commands

### Learn a CLI

```bash
cmdmint learn <binary> [--name <name>] [--max-subcommands <count>] [--json]
```

Learning performs only version and help probes in a temporary working directory, with a temporary HOME and a small secret-free environment. Pi runs `openai-codex/gpt-5.6-luna` at High thinking with tools, sessions, extensions, skills, prompt templates, and ambient context disabled.

The manifest is saved only after its help probes pass.

If the first candidate fails deterministic validation, `cmdmint` gives Pi the exact validator error and allows one correction pass. It never relaxes the validator or executes the rejected candidate.

### Discover methods

```bash
cmdmint --help
cmdmint help <primitive>
cmdmint help <primitive> --json
cmdmint list --json
cmdmint describe <primitive> --json
cmdmint describe <primitive>.<method> --json
```

Root help includes a live summary of every learned primitive. `help <primitive>` is the readable method guide; its JSON form is a compact agent-facing overview. `describe` remains the exact stored contract, including parameters, types, defaults, risk, output kind, evidence provenance, and the non-mutating verification probe.

### Ask what cmdmint learned

```bash
cmdmint ask "Which learned CLI can manage agent sessions?"
cmdmint ask herdr "Which operations change state?" --json
```

The first form searches all learned primitives. Supplying a primitive name scopes the question to that CLI. Pi receives only the stored manifests and captured help evidence, with tools and ambient context disabled. Every sufficient answer must return source IDs that `cmdmint` validates against the supplied registry packet; unsupported questions return an explicit `insufficientEvidence` result.

`ask` explains learned capabilities but never invokes a learned binary. Use `describe` plus `call` when an agent is ready to execute an exact method.

### Call a method

```bash
cmdmint call <primitive>.<method> \
  --args-json '{"name":"Ada"}' \
  --dry-run \
  --json
```

Remove `--dry-run` to execute. Methods classified as `write` or `destructive` require `--yes`. `cmdmint` deterministically escalates obvious mutation verbs such as `create`, `update`, and `delete`; it never downgrades the compiler's risk classification.

### Use natural language

```bash
cmdmint use <primitive> "list the ten newest repositories" --dry-run --json
```

Pi selects one learned method and binds its arguments. `cmdmint` then validates that selection against the manifest before planning or executing it. Prefer `call` once an agent already knows the method contract.

### Verify and diagnose

```bash
cmdmint test <primitive> --json
cmdmint doctor --json
```

`test` re-hashes the binary and runs only stored help probes. `doctor` checks Pi, the locked provider/model pair, and registry writability.

## Registry

The default registry is:

```text
~/.local/share/cmdmint/primitives/<name>/manifest.json
~/.local/share/cmdmint/primitives/<name>/evidence.json
```

Set `CMDMINT_HOME` to isolate another registry. Files are replaced atomically and written with user-only permissions.

The published manifest contract is also available at [`schema/primitive-manifest.schema.json`](schema/primitive-manifest.schema.json).

## Agent skill

The package includes [`skills/cmdmint/SKILL.md`](skills/cmdmint/SKILL.md). Install or link that folder into an agent's skill directory when automatic discovery is useful. The skill teaches agents the public command contract and deliberately treats the Pi/Luna implementation as replaceable.

## Security boundary

`cmdmint` reduces improvisation; it does not make an untrusted executable safe.

- Learning executes the target binary with `--version`, `-V`, `--help`, `-h`, and discovered `<subcommand> --help` probes. Do not learn a binary you would not otherwise execute.
- Help output is untrusted prompt data. Pi receives no tools and cannot execute it.
- Grounded answers are model-generated even though their source IDs are validated. Inspect consequential guidance before turning it into a call.
- Model output is not trusted. Runtime validation rejects unknown evidence, invented commands/options, malformed types, duplicate names, and unsafe probe shapes.
- Calls use the resolved executable path and check its SHA-256 fingerprint first.
- Arguments are passed directly to `spawn`; shell syntax remains literal data.
- Semantic risk classification can still be imperfect. Inspect newly learned manifests before approving consequential calls.

## Development

```bash
pnpm test
pnpm build
pnpm check
```

The integration suite uses real fixture executables rather than PTY or shell mocks. A release should also pass a live Pi learning canary and a globally installed CLI canary.

## Status

`cmdmint` is an early primitive with self-describing help and grounded Q&A over its local registry. Deeper recursive command discovery, replay fixtures for learned third-party tools, and packaged npm/Homebrew releases are natural follow-ups after the contract survives use in more than one real workflow.
