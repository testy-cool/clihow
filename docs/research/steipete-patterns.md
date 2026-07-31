# Steinberger repo patterns used by cmdmint

Checked against the live repositories on 2026-07-31.

## Adopted

- Keep one memorable binary with JSON output and explicit `doctor`/`dry-run` surfaces, as seen across [Oracle](https://github.com/steipete/oracle) and [Summarize](https://github.com/steipete/summarize).
- Keep the runtime local-first and deterministic, using an LLM only as a bounded pipeline stage, following [Lobster](https://github.com/openclaw/lobster).
- Discover a schema and expose generated method-shaped interfaces, while retaining diagnostics and machine-readable output, following [MCPorter](https://github.com/openclaw/mcporter).
- Provide one structured surface over a replaceable agent backend and ship an agent skill beside the executable, following [acpx](https://github.com/openclaw/acpx).
- Test through real subprocess integrations and small fixtures rather than PTY transcript scraping.

## Deliberately deferred

- npm and Homebrew release automation
- cross-repository release workflows like [release-workflows](https://github.com/openclaw/release-workflows)
- recursive/nested CLI discovery
- record/replay packages for learned third-party tools

Those become worthwhile after the primitive proves itself in at least two real workflows. The first version optimizes for a small contract that is easy to replace, inspect, and test.
