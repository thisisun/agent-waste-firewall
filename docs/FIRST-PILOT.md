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

## Confirm fresh hook delivery

Complete the selected provider's explicit plugin trust flow before the pilot:

- Codex: install and enable AWF, open `/hooks`, review the commands, and trust the exact current
  hook hash. An upgrade that changes a hook can require another review.
- Claude Code marketplace install: trust the source at load/install time, run
  `claude plugin marketplace add thisisun/agent-waste-firewall`, then
  `claude plugin install agent-waste-firewall@agent-waste-firewall`, and run `/reload-plugins`.
  Claude's `/hooks` is a read-only inspection view.
- Claude Code development checkout:
  `claude --plugin-dir /absolute/path/to/agent-waste-firewall` loads that checkout for one new
  session only. It is not a global installation and is not expected in the global plugin list.

In a normal terminal, start the read-only watcher:

```bash
agent-waste-firewall integration preflight codex --workspace . --timeout 3
agent-waste-firewall integration verify codex --timeout 60
# or
agent-waste-firewall integration verify claude --timeout 60 --json
```

For Codex, require the model-free preflight to return `ready` before any automated live pilot. It
sends only `initialize`, `initialized`, and `hooks/list`; it never starts a thread or model turn.
The result contains no paths, commands, hashes, provider errors, or raw RPC. Static readiness is a
prerequisite, not delivery proof. The matcher accepts only the canonical provider plugin ID
`agent-waste-firewall@agent-waste-firewall`; a custom-marketplace ID intentionally returns
`provider_plugin_not_found`. Even `ready` verifies only Codex-reported manifest-shaped metadata
and trust state, not the installed files, Codex binary, or later delivery. Real model-free
evidence includes an absent-plugin result in the current user environment and successful
four-hook discovery in an isolated marketplace install. The isolated gate accepts exact trusted
or untrusted metadata, so this pilot must still establish a user-owned `ready` result.

For `--json`, wait for
`AWF_READY provider=<codex|claude> timeoutSeconds=<1..300>` on stderr; stdout remains one final
closed result.

Then submit a new harmless short prompt in a separate conversation of that provider. Only a fresh
post-baseline audited prompt event can return `observed`; retained events and tool activity do not
count. The command never installs, enables, launches, or configures a provider. It is a local
delivery witness, not cryptographic proof of provider identity. A timeout is inconclusive. If
nothing arrives, check plugin enablement and reload/restart; also check Codex hook-hash trust or
Claude Code's `disableAllHooks` and managed `allowManagedHooksOnly` policy.

The reported `waitedMs` includes the operator's response time and polling delay. It is observation
wait only, not provider dispatch, outer-shell, or hook latency.

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
