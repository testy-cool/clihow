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
- List known primitives: `cmdmint list --json`
- Inspect an exact contract: `cmdmint describe <primitive>[.<method>] --json`
- Verify stored probes: `cmdmint test <primitive> --json`
- Call a known method: `cmdmint call <primitive>.<method> --args-json '<json>' --json`
- Bind natural-language intent: `cmdmint use <primitive> '<intent>' --dry-run --json`

Prefer `describe` plus `call` when deterministic behavior matters. Use `use` when choosing and binding the method is itself the hard part.

## Execute safely

Pass arguments only through `--args-json`; never construct or execute a shell command from a manifest. Start state-changing work with `--dry-run`. Add `--yes` only when the requested operation authorizes the reported `write` or `destructive` action.

If execution reports binary drift, run `cmdmint learn <binary>` again and re-inspect the contract. Do not edit registry JSON or bypass fingerprint checks.

Treat JSON output, exit status, stdout, and stderr as the result. Do not infer success from prose alone.
