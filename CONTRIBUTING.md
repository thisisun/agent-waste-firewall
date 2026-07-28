# Contributing

Contributions are welcome. Before opening a pull request, run the checks below and review the
privacy constraints in `SECURITY.md`.

## Development

```bash
npm run check
npm test
npm run test:coverage
npm run benchmark:hook
npm run benchmark:dashboard
node bin/agent-waste-firewall.mjs replay fixtures/repeated-test-loop.jsonl
```

Detector changes must include:

- a productive counterexample that must not be blocked;
- a waste fixture that should be detected;
- an evidence-based explanation;
- no new persistence of raw prompts, tool arguments, tool output, or source content.

Trace-schema or dashboard changes must also include:

- a valid semantic event fixture;
- an adversarial fixture containing paths, URLs, identifiers, and secret canaries;
- proof that unknown fields and free text are rejected rather than redacted after persistence;
- replay coverage in `observe`, `warn`, and `block` modes when decision behavior changes.

Keep the hot path deterministic and dependency-free. Optional model-assisted analysis belongs
behind a separate, opt-in adapter.
