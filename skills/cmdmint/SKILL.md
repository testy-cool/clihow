---
name: cmdmint
description: Learn installed command-line tools into evidence-backed, agent-discoverable method manifests and invoke them with validated JSON arguments. Use when an agent needs to operate an unfamiliar CLI, discover previously learned CLI methods, safely dry-run or call a method, or translate natural-language intent into a cmdmint primitive call.
---

# Use Cmdmint

Treat `cmdmint` as the stable interface. Do not depend on its internal model runtime.

## Check availability

Run:

```bash
command -v cmdmint
cmdmint doctor --json
```

Report a failed doctor check instead of guessing how to repair the underlying CLI or model setup.

## Choose the narrowest operation

- Learn an unfamiliar executable: `cmdmint learn <binary> --json`
- See the live learned set: `cmdmint --help`
- List known primitives: `cmdmint list --json`
- Read a primitive guide: `cmdmint help <primitive> --json`
- Inspect an exact contract: `cmdmint describe <primitive>[.<method>] --json`
- Ask across all learned evidence: `cmdmint ask '<question>' --json`
- Ask about cmdmint itself: `cmdmint ask cmdmint '<question>' --json`
- Ask about one primitive: `cmdmint ask <primitive> '<question>' --json`
- Preview the exact next model prompt: add `--show-prompt --json` to `learn`, `use`, or `ask`
- Trace actual prompts and captured responses: add `--trace-prompts <directory>` to `learn`, `use`, or `ask`
- Verify stored probes: `cmdmint test <primitive> --json`
- Call a known method: `cmdmint call <primitive>.<method> --args-json '<json>' --json`
- Bind natural-language intent: `cmdmint use <primitive> '<intent>' --dry-run --json`

Use `ask` to discover or explain what the registry supports. In an unscoped question, `you` and `your` refer to cmdmint; use the explicit `cmdmint` scope when only its own runtime and storage contract should be considered. Treat `insufficientEvidence: true` as a hard limit instead of filling gaps from memory. Prefer `describe` plus `call` when deterministic behavior matters. Use `use` when choosing and binding the method is itself the hard part.

## Inspect prompts

Use `--show-prompt --json` to inspect the exact `prompt` cmdmint would send next without contacting Pi. On `learn`, prompt construction still runs the target's bounded version and help probes; it does not save a primitive. On `use` and `ask`, previewing neither invokes Pi nor executes a learned binary.

Use `--trace-prompts <directory>` only when the user wants a record of real model exchanges. It preserves each exact prompt and captured Pi response as a user-only JSON file, including separate learning repair attempts. Pi stdout and stderr are each captured up to 1 MiB and can be truncated; the trace's `truncated` field records when either stream exceeded that limit. These files may contain the user's intent and complete CLI help evidence; treat the directory as sensitive. Do not combine tracing with `--show-prompt`.

## Execute safely

Pass arguments only through `--args-json`; never construct or execute a shell command from a manifest. Start state-changing work with `--dry-run`. Add `--yes` only when the requested operation authorizes the reported `write` or `destructive` action.

`ask` never executes a learned binary. Its JSON `sources` are registry references validated against the exact manifests and evidence supplied to Pi; they ground an explanation but do not authorize a later call.

Treat `<cmdmint-learning-home>` as an isolated temporary probe environment, never as the real configuration or data location of a learned CLI.

If execution reports binary drift, run `cmdmint learn <binary>` again and re-inspect the contract. Do not edit registry JSON or bypass fingerprint checks.

Treat JSON output, exit status, stdout, and stderr as the result. Do not infer success from prose alone.
