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
                                      |          +-- delegate scoped questions when declared
                                      +-- discover and ask over stored evidence
```

The model is used only for compilation, natural-language method selection, and grounded answers over stored registry evidence. A scoped ask can instead delegate to a learned CLI when its manifest explicitly declares a validated read-only question entrypoint. Probing, validation, storage, drift detection, approval gates, testing, and execution are deterministic.

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
cmdmint learn <binary> [--name <name>] [--max-subcommands <count>] [--show-prompt] [--trace-prompts <directory>] [--json]
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

### Ask for evidence or delegate a question

```bash
cmdmint ask "Which learned CLI can manage agent sessions?"
cmdmint ask cmdmint "Where do you keep your data?" --json
cmdmint ask herdr "Which operations change state?" --json
cmdmint ask agentconvos "Where did we decide how scraper fallbacks work?"
```

The first form searches all learned primitives plus cmdmint's active runtime metadata. In an unscoped question, words such as “you” and “your” refer to cmdmint itself. Use the explicit `cmdmint` scope for self-only questions, or supply a learned primitive name to scope the question to that CLI. Pi receives only the active registry metadata, stored manifests, and captured help evidence, with tools and ambient context disabled. Every sufficient answer must return source IDs that `cmdmint` validates against the supplied source packet; unsupported questions return an explicit `insufficientEvidence` result.

When a scoped primitive declares an `ask` binding, cmdmint instead invokes that exact read-only method with the question as its sole required argument. The binding is accepted only when deterministic validation confirms the method, risk, and parameter shape. Interactive delegated runs tee the target's stdout and stderr to the terminal while capturing the final stdout answer; `--json` captures the result without terminal redraws. `--show-prompt` prints a dry-run invocation with `prompt: null`, because cmdmint sends no model prompt on this delegated path. `--trace-prompts` is rejected for delegated asks rather than silently producing an empty trace.

### Continue an ask across terminals

Every successful `ask`—model-backed or delegated—is stored as a durable logical
thread. The transcript is the source of continuity, not a hidden Pi/Luna or
provider session:

```bash
# Start a thread. Plain output keeps the answer on stdout and prints its ID/hint on stderr.
cmdmint ask agentconvos "find the conversation where I created the MCP selector launcher"

# Continue it from any terminal; the stored scope is restored automatically.
cmdmint ask --thread THREAD_ID "What repository did that work create?"

# In an interactive terminal, prompt once for the follow-up question.
cmdmint ask --thread THREAD_ID

# Browse the same threads through agentconvos' Textual picker or fzf finder.
cmdmint threads
cmdmint threads --find "MCP selector"

# Inspect the newest-first inventory without starting another process.
cmdmint threads --json
```

Threads live at `$CMDMINT_HOME/threads/*.jsonl`, defaulting to
`~/.local/share/cmdmint/threads`. Thread files are mode `0600`; the containing
thread and lock directories are private. UUID prefixes are accepted when they
resolve uniquely. There is no implicit global `last`: use the explicit thread
ID or the picker. JSON ask output includes `threadId`; plain output preserves
the answer and writes a `Thread:`/`Continue:` hint to stderr. `--show-prompt`
reads or renders context without creating or changing a thread.

A cmdmint thread is a research transcript, not a native Claude, Codex, Pi, Agy,
or OpenCode session. Continue the research with `cmdmint ask --thread
THREAD_ID`; resume a cited native session separately with its original agent
ID. Earlier cmdmint answers are navigation context—not authoritative evidence—
so follow-ups re-check the underlying learned evidence or cited source turns.
Interactive delegated asks keep the underlying agentconvos Rich cockpit visible
while cmdmint captures and persists only the completed stdout answer; cockpit
control output from stderr is not stored in the thread.

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

### Inspect model prompts

Print the exact next prompt without contacting Pi:

```bash
cmdmint learn gh --show-prompt
cmdmint use gh "list the ten newest repositories" --show-prompt
cmdmint ask gh "How do I list repositories?" --show-prompt
```

Add `--json` when a machine-readable object with a `prompt` field is easier to inspect. Previewing `use` or `ask` has no execution side effects. A delegated scoped ask reports `prompt: null` and its exact dry-run argv. Previewing `learn` still runs the bounded version and help probes needed to construct the evidence packet, but it does not contact Pi, validate a model response, or save a primitive.

Record the prompts that are actually sent and the captured Pi responses from a normal operation:

```bash
cmdmint ask gh "How do I list repositories?" \
  --trace-prompts ./cmdmint-prompt-traces \
  --json
```

Each model exchange becomes a user-only JSON file containing the engine, exact prompt, captured response (Pi stdout), captured stderr, exit status, timing, and truncation state. Stdout and stderr are each captured up to 1 MiB and can be truncated; the trace's `truncated` field records when either stream exceeded that limit. A learning repair attempt creates another trace file. Trace files can contain user intent and complete learned help evidence, so choose the directory deliberately and treat it as sensitive. `--show-prompt` and `--trace-prompts` cannot be combined.

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
~/.local/share/cmdmint/threads/<uuid>.jsonl
```

Set `CMDMINT_HOME` to isolate another registry. Files are replaced atomically and written with user-only permissions.

The published manifest contract is also available at [`schema/primitive-manifest.schema.json`](schema/primitive-manifest.schema.json).

## Agent skill

The package includes [`skills/cmdmint/SKILL.md`](skills/cmdmint/SKILL.md). Install or link that folder into an agent's skill directory when automatic discovery is useful. The skill teaches agents the public command contract and deliberately treats the Pi/Luna implementation as replaceable.

## Security boundary

`cmdmint` reduces improvisation; it does not make an untrusted executable safe.

- Learning executes the target binary with `--version`, `-V`, `--help`, `-h`, and discovered `<subcommand> --help` probes. Do not learn a binary you would not otherwise execute.
- Learning uses isolated temporary HOME and XDG directories. Paths derived from that sandbox are stored and queried as `<cmdmint-learning-home>`, never presented as persistent user-data locations.
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
