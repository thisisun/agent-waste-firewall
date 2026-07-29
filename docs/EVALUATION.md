# Evaluation plan

The project should not claim token savings until it passes replay-based evaluation.

## Dataset

Create a redacted JSONL corpus with:

- productive repeated work;
- identical tool loops;
- repeated failures with and without intervening edits;
- file edit/revert oscillation;
- test commands that legitimately repeat after progress;
- long-running wait/status polling;
- underspecified and well-specified prompts in Korean and English.

The first real-world corpus should be an observe-only semantic recording of a long-running release
preparation task. Raw prompts, hook payloads, commands, paths, outputs, and source code must not be
committed.

Create it with the product path rather than an ad-hoc redaction script:

```bash
agent-waste-firewall record start \
  --workspace /absolute/path/to/project \
  --label release-pilot \
  --mode observe
agent-waste-firewall dashboard

# Stop at the declared boundary before an external deployment, signing,
# credential access, upload, or submission.
agent-waste-firewall record stop
agent-waste-firewall trace audit <trace-id>
agent-waste-firewall trace export <trace-id> --output semantic-trace.jsonl
```

The no-argument dashboard is the always-on live view; the recording remains a separate export
artifact. To inspect the stopped recording instead, run
`agent-waste-firewall dashboard <trace-id>`.

Run the exported trace through all three policies:

```bash
agent-waste-firewall replay semantic-trace.jsonl --mode observe --json
agent-waste-firewall replay semantic-trace.jsonl --mode warn --json
agent-waste-firewall replay semantic-trace.jsonl --mode block --json
```

## Labels

Every candidate incident receives:

- start and end event;
- primary cause: instruction, agent, environment, or harness;
- whether intervention was appropriate;
- earliest safe warning event;
- earliest safe blocking event;
- task completion impact.

Keep human episode labels in a separate closed-schema file. Do not add free-text notes to the
semantic event stream. A suitable initial vocabulary is:

- episode: `productive`, `waste`, or `unknown`;
- cause: `user_instruction`, `agent`, `environment`, or `harness`;
- intervention: `appropriate`, `too_early`, `too_late`, or `not_needed`;
- completion impact: `positive`, `none`, `negative`, or `unknown`.

## Go/no-go targets for the first public beta

- Detect at least 70% of labeled waste episodes.
- Warn before half of each episode's wasted tool calls occur.
- Keep false blocking below 5% of productive sessions.
- Keep deterministic hook latency below 100 ms at p95.
- Keep trace append and dashboard streaming below the same 100 ms hook-path p95 target.
- Preserve task completion rate compared with no guard.
- Send zero raw prompt, tool output, or source content off-device.
- Keep raw session IDs and absolute workspace paths out of persisted state.
- Export no raw or relative paths, file names, wall-clock timestamps, local labels, trace keys, or
  free text.

These are proposed product thresholds, not current measured results.

## Metrics

- incident precision and recall;
- false-warning and false-block rates;
- calls before detection and, only after a real usage adapter exists, tokens before detection;
- elapsed time before detection;
- repeated behavior after a warning;
- task completion and verification outcome;
- detector latency;
- user comprehension of the warning.

Token savings should be computed from actual observed token deltas, not from a fixed tokens-per-call
multiplier.

## Release-workflow interpretation

A complete candidate check may intentionally contain many child checks. Treat it as one parent
action when the coding agent issued only the wrapper command. A rerun after a changed commit,
source tree, release ledger, manifest, gate state, or evidence hash can be productive. A rerun with
the same progress fingerprint is a waste candidate.

The default high-cost warning threshold is therefore two identical `test`, `build`, `verify`, or
`release` calls without progress. This is an early warning, not proof of waste. Signing, deployment,
migration, credential access, upload, and store submission are outside the first observe-only
pilot and require separate user authorization.
