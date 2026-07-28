# Validation report — 2026-07-29

This report records a local functional, privacy, browser, and performance evaluation of the
current `0.1.0` research alpha. It is evidence from one machine, not a cross-platform performance
guarantee.

## Verdict

The current Node.js product path works as a research alpha:

- Codex- and Claude-shaped hook events reach the real stdin/stdout hook worker.
- Prompt-contract, repeated-call, and repeated-failure decisions work.
- Observe, warn, and block policies behave differently as designed.
- Multi-session semantic recording, audit, export, replay, and the loopback dashboard work.
- The hook hot path is below the proposed 100 ms p95 target on this machine.
- Warm dashboard status remains below the proposed 100 ms p95 target at 100,000 events on this
  machine.
- Exported trace scans found none of the synthetic prompt, command, session, or workspace markers.

It is not yet a distributable macOS application:

- there is no SwiftUI/AppKit target, menu-bar app, transparent `NSPanel`, signed helper, DMG,
  notarization, or one-click integration manager;
- exact token usage is not measured;
- the always-on transport is not yet a bounded `LiveEventV1` spool;
- actual Codex and Claude installations have not yet passed the provider acceptance matrix.

## Environment

- Apple silicon Mac
- macOS 26.5.2
- Node.js 22.22.3
- npm 10.9.8
- real hook entry point: `node scripts/hook.mjs`

Codex CLI was present (`0.146.0-alpha.3.1`) but this plugin was not installed in its configured
marketplaces. Claude Code was not installed. Provider integration results below therefore test the
real AWF hook executable with synthetic official-shape events, not an installed-provider
smoke test.

## Current verification

| Check | Result |
| --- | --- |
| `npm run check` | Pass: 30 JavaScript files and 5 JSON manifests |
| `npm test` | Pass: 100/100 |
| Line coverage | 94.53% |
| Branch coverage | 82.02% |
| Function coverage | 93.62% |
| `src/cli.mjs` line coverage | 57.32% |
| `npm pack --dry-run --json` | Pass: 52 files, approximately 1.73 MB packed |
| `npm audit --omit=dev --ignore-scripts` | Pass: 0 known vulnerabilities |
| `doctor --json` | Pass: all 13 current checks |

The doctor command currently proves repository files, data-directory access, and the Node version.
It does not prove that Codex or Claude has loaded and trusted the plugin.

## Functional end-to-end results

### Prompt coach

A synthetic, broad Korean action request received:

- score: `0/100`;
- severity: `high`;
- issues: `broad`, `target`, `success`, `verify`, and `stop`;
- a five-part Korean replacement template.

In `block` mode the hook returned a prompt-block decision. In `warn` mode it returned additional
context without blocking.

### Codex-shaped event flow

Using one real hook subprocess for each event:

- the first repeated test call was allowed;
- the second identical no-progress call produced an evidence warning;
- a deduplicated intermediate repeat did not spam another warning;
- the fourth identical no-progress call was denied before execution.

### Claude-shaped failure flow

Using `PostToolUseFailure` events:

- two equal failure results were normalized;
- the next identical pre-tool retry was denied;
- warning/denial output used the shared provider-neutral detector policy.

### Policy replay

The same eight-event synthetic fixture produced:

- `observe`: record incidents without intervention;
- `warn`: warn on all four detected incidents;
- `block`: block the severe prompt and high-confidence repeated-failure retry, while retaining a
  warning for non-blockable evidence.

### Dashboard and browser

The real dashboard CLI was started on a random loopback port and random access token.

- authorized document, status, and SSE requests succeeded;
- the status projection reported 3 events, 2 incidents, and 1 avoidable-call candidate;
- SSE emitted prompt, tool, and incident events with semantic aliases only;
- the page rendered meaningful content with no console errors or framework error overlay;
- signal state changed to `warn` and the tab title showed review state;
- compact sentinel mode opened and expanded again;
- light/dark mode and English/Korean switching worked;
- browser output did not provide a truly transparent always-on desktop window. That requires the
  planned native `NSPanel`.

## Privacy checks

- A 15,113-event single-session trace passed the closed-schema audit.
- Export contained 15,113 lines and was 6,158,883 bytes.
- The export did not contain the synthetic raw prompt marker, command marker, session ID, or
  temporary workspace path.
- DetectorStateV4 persisted none of the injected workspace basename/path, file name/path, provider
  tool name, prompt, input, output, or source canaries.
- Current-version unknown fields were removed before the next atomic state write.
- Session, workspace, file, command, result, and incident identifiers were represented only by
  domain-separated, session-scoped aliases or fingerprints.
- A legacy V3 state was replaced by a V4 projection when its session next became active.
- Trace audit took about 0.15 seconds, export about 0.26 seconds, and semantic replay about
  0.08 seconds.
- Data directories were mode `0700`.
- State, trace, and export files inspected in the test were mode `0600`.

These checks validate selected synthetic canaries. They do not replace the full adversarial privacy
matrix required before beta.

## Hook latency

Each sample launched a fresh real Node hook process and included process creation, stdin JSON
parsing, detector/state work, atomic local writes, stdout JSON, and process exit. Warmups were
excluded.

The earlier three-condition snapshot was:

| Condition | Samples | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| No active semantic trace | 150 | 43.39 ms | 46.24 ms | 48.30 ms | 54.28 ms |
| Active semantic recording | 150 | 44.66 ms | 47.44 ms | 49.40 ms | 56.76 ms |
| Active trace already over 15,000 events | 100 | 45.17 ms | 47.58 ms | 50.46 ms | 52.73 ms |

The active recording added about 1.2 ms at p95 in that controlled comparison. Trace length did not
materially slow the hook because append does not reread the complete event file.

The CLI now lazily imports the dashboard so every hook process no longer parses the dashboard
bundle or loads its images. The checked-in `npm run benchmark:hook` gate, with an active semantic
trace, then measured:

| Condition | Samples | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Active semantic recording | 100 | 36.62 ms | 39.37 ms | 40.15 ms | 40.36 ms |

The product target remains 100 ms p95. GitHub Actions enforces that budget on Ubuntu; the shared
macOS runner uses a separate 150 ms CI budget because cold Node process creation showed materially
higher runner variance. Local macOS performance is reported against the 100 ms product target.

Not yet covered:

- concurrent lock contention;
- large post-tool outputs;
- file-content hash work;
- slow or nearly full disks;
- Intel Macs and older supported macOS versions;
- minimum supported Node.js 18.

## Dashboard scaling before the cursor milestone

Before the incremental cursor was implemented, the status endpoint read and audited the entire
trace for each request. Sequential loopback requests produced:

| Trace size | Samples | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| 3 events | 200 | 0.22 ms | 0.39 ms | 0.49 ms | 0.61 ms |
| 5,003 events | 100 | 37.99 ms | 44.94 ms | 54.99 ms | 66.45 ms |
| 10,003 events | 50 | 75.25 ms | 83.44 ms | 84.99 ms | 84.99 ms |
| 15,003 events | 30 | 112.35 ms | 121.39 ms | 126.17 ms | 126.17 ms |

The 15,003-event case failed the proposed 100 ms p95 target. The resolution and current measurements
are recorded below.

## Resolved blockers and remaining release gaps

### Resolved P0 — Multi-session workspace recording

Recording selection is workspace-scoped and accepts events from multiple sessions. Trace audit
requires one unchanged session alias.

Observed with two sessions in one workspace:

- metadata recorded 10 events;
- audit returned `session_alias_changed` for the second session;
- dashboard metadata still reported the event count but its audited timeline became empty;
- SSE emitted no semantic events;
- export was refused.

Choose and enforce one contract:

1. create a separate trace for each `(workspace, provider, session)` and aggregate only validated
   projections in the dashboard; or
2. version the trace schema for a validated multi-session recording model.

The first option has the smaller privacy and migration surface.

Resolution after this snapshot: the second contract was adopted without adding free-text fields.
Workspace recordings now accept multiple trace-local session aliases while preserving global
sequence and elapsed-time integrity. Regression coverage includes two concurrent pseudonymous
sessions. The privacy documentation now states that a multi-session export reveals the number of
distinct aliases observed in that explicit recording window.

### Resolved P1 — Dashboard full-trace polling

The 15,003-event p95 result exceeds the current performance gate. Implement incremental validation
and bounded retention before calling the monitor suitable for 24–90 hour work.

Resolution after this snapshot: the dashboard now performs one strict cold audit, then reads and
audits only complete appended JSONL bytes. `npm run benchmark:dashboard` is checked in for
reproduction. A same-machine post-fix run produced:

| Events before append | Cold startup | Warm `/api/status` p95 | One-event append visible |
| ---: | ---: | ---: | ---: |
| 15,000 | 69.37 ms | 1.47 ms | 1.64 ms |
| 100,000 | 322.95 ms | 4.09 ms | 3.27 ms |

The cold audit intentionally remains proportional to trace size; steady-state polling no longer
rereads or reparses the whole file. Bounded `LiveEventV1` retention is still required for the
always-on beta transport.

Malformed loopback request targets now return a closed `400` response, active SSE connections no
longer prevent shutdown, trace rotation resets existing streams, and an invalid complete append
changes both the API and compact sentinel to an allowlisted red `degraded` state without exposing
the rejected bytes.

### P1 — No installed-provider acceptance test

The local Codex plugin list did not contain this project, and Claude Code was unavailable. A public
claim of Codex/Claude compatibility still requires install, trust, live warning, upgrade, and
uninstall smoke tests in the actual provider applications.

### P1 — No native macOS product

The requested menu-bar status, true transparent sentinel, start-at-login behavior, bundled runtime,
signed application, and notarized GitHub artifact remain unimplemented.

### P1 — No exact token accounting

The working metrics are observed events, incidents, avoidable-call candidates, and elapsed time.
Do not display “tokens saved” until a read-only provider usage adapter supplies actual counters.

### P2 — Misleading export error detail

The multi-session export diagnostic ended with `(undefined)` because the formatter uses the wrong
finding property. This does not expose input, but it should be corrected and regression-tested.

Resolution after this snapshot: trace read/export errors now print the audited closed `code` value.

### Resolved P1 — Detector state retained excessive hook metadata

The pre-publication V3 detector state retained fields such as workspace basenames, relative file
paths, provider tool names, and incident prose. Even without complete prompts or tool outputs,
those fields exceeded AWF's stated closed-semantic storage contract.

Resolution: DetectorStateV4 projects state through a closed allowlist before every write. It stores
only bounded enums, numbers, booleans, and domain-separated aliases or fingerprints. Raw hook JSON,
prompt text, tool input/output, source content, paths, filenames, provider tool names, and incident
prose are excluded. Regression coverage includes raw canaries, injected unknown fields, legacy
state replacement, session-scoped aliases, an edit-revert positive fixture, and a productive
`A → B → C` counterexample.

## Recommended next implementation order

1. ~~Fix the P0 session/trace ownership contract and add a two-session regression test.~~ Completed.
2. ~~Implement an incrementally audited cursor and session-aware dashboard projection.~~ Completed.
3. Implement `LiveEventV1`, a bounded always-on spool independent of explicit recording.
4. Run the configured hook/dashboard checks on macOS and Linux CI after the repository is
   published.
5. Add real Codex and Claude install/trust smoke tests.
6. Build the SwiftUI/AppKit shell, menu bar, and transparent sentinel.
7. Bundle/sign the worker and add install/repair/rollback/uninstall ownership tracking.
8. Sign, notarize, staple, and Gatekeeper-test GitHub artifacts.
9. Add optional actual-usage adapters and run the observe-only evaluation corpus.

Current release classification: **working Node research alpha; no-go as an installable macOS beta**.
