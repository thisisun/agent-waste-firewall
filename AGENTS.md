# Agent instructions

- Preserve local-first, dependency-free hook execution.
- Never persist raw prompts, tool inputs, tool outputs, transcript text, or source-file content.
- Build exported traces from closed semantic allowlists; never record raw hook JSON and redact it later.
- Keep the dashboard loopback-only, dependency-free, and limited to audited semantic events.
- Treat causal attribution as evidence, not blame.
- Add both a positive fixture and a productive counterexample for detector changes.
- Keep `Stop` observation-only unless a bounded continuation design and regression tests are added.
- Run `npm run check` and `npm test` before completing changes.
