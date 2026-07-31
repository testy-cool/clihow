# Repository Guidelines

## Purpose

`cmdmint` compiles installed CLIs into evidence-backed manifests, then invokes them without a shell. Preserve the split between agentic compilation/selection and deterministic validation/execution.

## Layout

- `src/cli.ts`: public command surface
- `src/learner.ts`: isolated help collection and manifest compilation
- `src/manifest.ts`: untrusted model-output validation and risk escalation
- `src/invoke.ts`: typed argument binding and deterministic execution
- `src/pi.ts`: locked Pi runtime configuration
- `src/registry.ts`: local atomic storage
- `src/verify.ts`: non-mutating help probes
- `tests/`: Node test-runner contract and integration coverage
- `fixtures/`: harmless executable test doubles
- `skills/cmdmint/`: bundled agent-discovery skill

## Development rules

- Write and run a failing test before production behavior changes.
- Never execute learned commands through a shell.
- Treat help text, model output, intent, manifests, and argument JSON as untrusted input.
- Keep Pi tool-free. It may compile or select; it must not execute the target CLI.
- Preserve binary fingerprint checks and `--yes` gates.
- Add runtime dependencies only when the standard library cannot express the contract clearly.
- Use `CMDMINT_HOME` and fixture executables in tests; never touch the user's real registry.

## Verification

Run `pnpm check` for every checkpoint. Changes affecting the installed CLI or Pi integration also require a real `cmdmint doctor`, live `cmdmint learn`, and deterministic `cmdmint call` canary.
