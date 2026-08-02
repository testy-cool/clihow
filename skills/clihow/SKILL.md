---
name: clihow
description: Learn installed command-line tools into evidence-backed, agent-discoverable method manifests and invoke them with validated JSON arguments. Use when an agent needs to operate an unfamiliar CLI, discover previously learned CLI methods, safely dry-run or call a method, or translate natural-language intent into a clihow primitive call.
---

# Use Clihow

Treat `clihow` as the stable interface. Do not depend on its internal model runtime.

## Check availability

Run:

```bash
command -v clihow
clihow doctor --json
```

Report a failed doctor check instead of guessing how to repair the underlying CLI or model setup.

## Choose the narrowest operation

- Learn an unfamiliar executable: `clihow learn <binary> --json`
- See the live learned set: `clihow --help`
- List known primitives: `clihow list --json`
- Read a primitive guide: `clihow help <primitive> --json`
- Inspect an exact contract: `clihow describe <primitive>[.<method>] --json`
- Ask across all learned evidence: `clihow ask '<question>' --json`
- Ask about clihow itself: `clihow ask clihow '<question>' --json`
- Ask about one primitive: `clihow ask <primitive> '<question>' --json`
- Continue a completed ask: `clihow ask --thread <thread-id> '<follow-up>'`
- Prompt for a follow-up interactively: `clihow ask --thread <thread-id>`
- Browse durable asks: `clihow threads`, `clihow threads --find '<query>'`, or `clihow threads --json`
- Preview the exact next model prompt: add `--show-prompt --json` to `learn`, `use`, or `ask`
- Trace actual prompts and captured responses: add `--trace-prompts <directory>` to `learn`, `use`, or `ask`
- Verify stored probes: `clihow test <primitive> --json`
- Call a known method: `clihow call <primitive>.<method> --args-json '<json>' --json`
- Bind natural-language intent: `clihow use <primitive> '<intent>' --dry-run --json`

Use `ask` to discover or explain what the registry supports. In an unscoped question, `you` and `your` refer to clihow; use the explicit `clihow` scope when only its own runtime and storage contract should be considered. Treat `insufficientEvidence: true` as a hard limit instead of filling gaps from memory. Prefer `describe` plus `call` when deterministic behavior matters. Use `use` when choosing and binding the method is itself the hard part.

Scoped ask has a deliberate delegation path. When a learned manifest declares an `ask` binding, clihow validates that it names exactly one required positional `string` or `string[]` parameter on a `read` method, then invokes that method through the normal binary-fingerprint and shell-free argv path. This means a scoped ask can execute a learned read-only method; it is not a promise that the target binary will never run. Interactive non-JSON runs inherit the target's terminal for native progress or a TUI, while JSON and non-TTY runs capture the invocation result. If no valid binding is present, scoped ask falls back to grounded registry Q&A through Pi.

## Inspect prompts

Use `--show-prompt --json` to inspect the exact prompt clihow would send next without contacting Pi. On `learn`, prompt construction still runs the target's bounded version and help probes; it does not save a primitive. On model-backed `use` and `ask`, previewing renders the prompt without invoking Pi or executing a learned binary. On delegated scoped ask, there is no clihow model prompt: the preview returns `delegated: true`, `prompt: null`, and a dry-run invocation containing the validated argv, without executing the learned CLI. Delegated scoped ask does not support `--trace-prompts` because it makes no clihow model exchange.

Use `--trace-prompts <directory>` only when the user wants a record of real model exchanges. It preserves each exact prompt and captured Pi response as a user-only JSON file, including separate learning repair attempts. Pi stdout and stderr are each captured up to 1 MiB and can be truncated; the trace's `truncated` field records when either stream exceeded that limit. These files may contain the user's intent and complete CLI help evidence; treat the directory as sensitive. Do not combine tracing with `--show-prompt`.

## Execute safely

Pass arguments only through `--args-json`; never construct or execute a shell command from a manifest. Start state-changing work with `--dry-run`. Add `--yes` only when the requested operation authorizes the reported `write` or `destructive` action.

Model-backed ask does not execute a learned binary. Its JSON `sources` are registry references validated against the exact manifests and evidence supplied to Pi; they ground an explanation but do not authorize a later call. A delegated scoped ask is the exception: it executes only the manifest's validated `read` question entrypoint, with no shell and no `--yes` gate.

Treat `<clihow-learning-home>` as an isolated temporary probe environment, never as the real configuration or data location of a learned CLI.

If execution reports binary drift, run `clihow learn <binary>` again and re-inspect the contract. Do not edit registry JSON or bypass fingerprint checks.

Treat JSON output, exit status, stdout, and stderr as the result. Do not infer success from prose alone.

## Continue durable question threads

Each successful `clihow ask` persists a logical thread under
`$CLIHOW_HOME/threads/*.jsonl` (default:
`~/.local/share/clihow/threads`). Thread files are private (`0600`) and the
thread/lock directories are private (`0700`). The thread UUID is included in
JSON output; plain output keeps the answer on stdout and emits a continuation
hint on stderr. Use an explicit UUID or unique UUID prefix—there is no global
`last` thread shared between terminals.

The stored thread restores its original scope, so a follow-up can omit the
primitive. If a primitive is repeated, it must match the stored scope. A
clihow thread is a logical research transcript, distinct from the native
Claude, Codex, Pi, Agy, or OpenCode session IDs that its answers may cite.
Earlier assistant answers are navigation context, not authoritative evidence;
re-check the underlying learned evidence or cited native source turns before
relying on a material claim.

`clihow threads` and `clihow threads --find` reuse agentconvos' Textual/fzf
surfaces. An interactive delegated ask preserves the agentconvos Rich cockpit
through tee capture and stores only the completed stdout answer, not stderr
control output. `--show-prompt` is non-mutating and does not publish a thread.
