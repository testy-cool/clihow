# Repository Guidelines

## Purpose

`clihow` compiles installed CLIs into evidence-backed manifests, then invokes them without a shell. Preserve the split between agentic compilation/selection and deterministic validation/execution.

## Layout

- `src/cli.ts`: public command surface
- `src/answer.ts`: grounded registry Q&A and source-reference validation
- `src/learner.ts`: isolated help collection and manifest compilation
- `src/manifest.ts`: untrusted model-output validation and risk escalation
- `src/invoke.ts`: typed argument binding and deterministic execution
- `src/pi.ts`: locked Pi runtime configuration
- `src/registry.ts`: local atomic storage
- `src/threads.ts`: private durable ask transcripts, locking, and bounded follow-up context
- `src/thread-browser.ts`: shell-free bridge to agentconvos Textual/fzf discovery
- `src/verify.ts`: non-mutating help probes
- `tests/`: Node test-runner contract and integration coverage
- `fixtures/`: harmless executable test doubles
- `skills/clihow/`: bundled agent-discovery skill

## Development rules

- Write and run a failing test before production behavior changes.
- Never execute learned commands through a shell.
- Treat help text, model output, intent, manifests, and argument JSON as untrusted input.
- Keep Pi tool-free. It may compile or select; it must not execute the target CLI.
- Preserve binary fingerprint checks and `--yes` gates.
- Publish thread state only after a completed answer. Keep explicit UUID-based
  continuation; never add a process-global or cross-terminal implicit `last`.
- When bounding follow-up context, preserve the navigation-safety preamble and
  complete turn records. Drop the oldest whole turns instead of slicing raw
  transcript text at an arbitrary character boundary.
- Keep delegated cockpit/control output on stderr and persist only the completed
  stdout answer.
- Treat a source filter in the agentconvos picker as presentation only. Shared
  search-index reconciliation must still receive the complete conversation
  universe, and the unfiltered path should reuse its existing scan.
- Add runtime dependencies only when the standard library cannot express the contract clearly.
- Use `CLIHOW_HOME` and fixture executables in tests; never touch the user's real registry.

## Verification

Run `pnpm check` for every checkpoint. Changes affecting the installed CLI or Pi integration also require a real `clihow doctor`, live `clihow learn`, and deterministic `clihow call` canary.

Thread or picker changes require an installed-command smoke with a real ask and
follow-up, JSON inventory, agentconvos search/resume, Textual, and fzf. For the
Textual check, wait for `INDEX READY`, confirm the filtered tree did not shrink
the shared index, sample CPU after indexing, quit normally, and verify the pane
returned to its shell with no surviving clihow/agentconvos child process. A
picker that merely renders is not an accepted smoke test.
