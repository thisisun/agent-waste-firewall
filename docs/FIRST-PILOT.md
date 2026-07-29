# First live pilot

Use the first real-world run to measure detector quality, not to prove token savings.

## Safety boundary

Choose one repository and start in `observe` mode. Stop the pilot before the first external state
change:

- staging or production deployment;
- database migration against a linked or remote project;
- signing or access to a keychain, keystore, certificate, or credential manager;
- TestFlight, Play Console, package-registry, or store upload;
- release submission or publication;
- `git push` or creation of an external release.

Those actions can be evaluated in a later, separately authorized run. They are not required to
validate real-time loop detection.

## Suggested task contract

```text
Task: Prepare the selected release through local pre-deployment readiness.
Scope: Inspect the current branch and working tree, finish only the named release blockers,
and preserve existing release artifacts and unrelated user changes.
Done when: Remaining blockers are listed, scoped local checks pass, and the repository is ready
for the next externally authorized stage.
Verify with: Run targeted checks first. Run one full candidate check only after its prerequisites
and progress fingerprint have changed.
Stop when: Stop and report after the same failure repeats twice, or before any deployment,
remote migration, signing, credential access, upload, push, or submission.
```

## Run

```bash
agent-waste-firewall record start \
  --workspace /absolute/path/to/repository \
  --label release-readiness \
  --mode observe

agent-waste-firewall dashboard
```

Load the AWF — Agent Waste Firewall plugin in Codex or Claude Code and run the scoped task in the same
workspace. Keep the dashboard visible beside the coding-agent window. This no-argument command is
the always-on live view; it does not make the research trace exportable.

When the task reaches the boundary:

```bash
agent-waste-firewall record stop
agent-waste-firewall trace audit <trace-id>
agent-waste-firewall dashboard <trace-id>
agent-waste-firewall trace export <trace-id> --output semantic-trace.jsonl
```

Replay all policies and compare their actions:

```bash
agent-waste-firewall replay semantic-trace.jsonl --mode observe --json
agent-waste-firewall replay semantic-trace.jsonl --mode warn --json
agent-waste-firewall replay semantic-trace.jsonl --mode block --json
```

## Labeling

Review the semantic timeline without reopening raw prompts or outputs. For each episode, label:

- whether it was productive, waste, or unknown;
- the earliest appropriate warning;
- whether a block would have prevented useful work;
- the evidence attribution;
- how many observable calls occurred before and after the warning.

Do not estimate tokens from a fixed calls-to-tokens multiplier. Add token comparisons only after an
actual usage adapter records provider-supported counters.
