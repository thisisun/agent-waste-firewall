# Validation report — 2026-07-29

This report records a local functional, privacy, browser, performance, and unsigned native
source-build evaluation of the current `0.1.0` research alpha. It is evidence from one machine, not
a cross-platform performance guarantee or a signed-release certification.

## Verdict

The current Node.js product path works as a research alpha:

- Codex- and Claude-shaped hook events reach the real stdin/stdout hook worker.
- Prompt-contract, repeated-call, and repeated-failure decisions work.
- Observe, warn, and block policies behave differently as designed.
- Supported hook events now make a best-effort publication to a bounded, always-on `LiveEventV1`
  spool without requiring an explicit trace.
- The default loopback dashboard consumes that spool without `record start`; an explicit trace ID
  selects the historical audited-trace view.
- A read-only provider reality gate now distinguishes AWF engine readiness, provider installation
  state, and audited hook activity. Its closed result is available from
  `integration status [--json]` and the dashboard provider cards.
- A bounded `integration verify <codex|claude>` witness now excludes retained, other-provider, and
  tool events, then accepts only a fresh audited prompt event after its baseline. A real CLI child
  and real hook-worker child passed this path without changing sentinel provider configuration.
- The isolated Codex and Claude gates passed marketplace add/install/inventory, installed-launcher
  execution across four and five hook phases respectively, closed semantic events, raw-canary
  exclusion, and temporary-tree cleanup checks on this Mac. Claude explicitly reports provider
  delivery as `not_tested`.
- macOS/POSIX hooks now use an inner fail-open launcher. Once it starts under `/bin/sh -p`, it does
  not search inherited `PATH`; it scrubs Node/dynamic-loader injection variables, rejects symlink
  or group/world-writable worker/runtime files on macOS, and uses only explicit or bounded external
  Node candidates. Claude reaches it through exec-form arguments. Codex first evaluates its command
  string through inherited `$SHELL -lc`, so user/provider login-shell startup remains a trusted
  boundary outside AWF's scrubbing and direct tests. The launcher emits one fixed, raw-free stderr
  warning for each event it cannot check; this pre-runtime warning is not rate-limited. Windows
  provider-hook execution is unsupported.
- Multi-session semantic recording, audit, export, and replay work independently of the live UI.
- The directly tested inner-launcher hook path is below the proposed 100 ms p95 target on this
  machine; provider dispatch and Codex's outer login shell are not included.
- Warm live-dashboard status remains below the proposed 100 ms p95 target with its complete
  4,096-event bounded generation, and the historical trace cursor remains below the target at
  15,000 events on this machine.
- Exported trace scans found none of the synthetic prompt, command, session, or workspace markers.
- A macOS 13+ SwiftUI/AppKit developer-preview target now builds from source without signing. It
  contains a menu bar, restricted local `WKWebView`, transparent floating `NSPanel`, app-owned
  dashboard supervisor, and closed Swift readiness/status decoders.
- The native `AWFTests` target passes 39/39 with no skips, including inherited-`PATH` rejection,
  bounded Finder-style NVM discovery, an actual launch of the worker copied into the built app,
  and a validated loopback status fetch.

It is not yet a distributable macOS application:

- the source build has no Developer ID signature, notarization ticket, DMG, bundled Node runtime,
  update path, start-at-login service, or one-click integration manager;
- the current PR head passes the configured GitHub Node matrix, dashboard benchmark jobs, and
  native build/unit job, but the UI target is excluded and the local UI runner did not materialize
  its worker;
- exact token usage is not measured;
- actual user-owned Codex `/hooks` trust/live delivery and Claude source-trust/live delivery have
  not yet passed the provider acceptance matrix.

## Environment

- Apple silicon Mac
- macOS 26.5.2
- Xcode 26.6 (build 17F113)
- Swift 6.3.3
- Node.js 22.22.3
- npm 10.9.8
- directly tested inner macOS/POSIX launcher:
  `/bin/sh -p scripts/hook-launcher.sh <plugin-root>` with an explicit Node runtime

Claude's exec-form hook invokes that inner command directly. Codex command hooks first pass through
inherited `$SHELL -lc`, as shown in the
[Codex command-runner source](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/command_runner.rs#L125-L164).
No provider-driven hostile login-shell startup was tested.

Codex CLI was present (`0.146.0-alpha.3.1`). The new closed status probe normalizes its public
version to `0.146.0` and reports `needs_install`. The shell-inherited CLI probe reports Claude Code
as `not_detected` because that shell `PATH` excludes its user-local install directory. The native
supervisor's closed search path finds Claude Code `2.1.207` and reports `needs_install`. Provider
warning flows below use the real AWF hook executable with synthetic official-shape events. The
separate isolated acceptance subsection records the installed-plugin/direct-launcher smoke tests. No
global provider configuration or trust decision was changed during either check.

The isolated provider acceptance runners then used private temporary provider state. Both passed
temporary marketplace add/install/inventory, installed-launcher execution, closed `LiveEventV1`
production, bounded scanning for raw canaries, and complete temporary-tree cleanup. Because they
invoke installed launchers directly instead of user-owned sessions, this is package/install-path
evidence rather than provider trust or live-delivery evidence.

## Current portable verification

| Check | Result |
| --- | --- |
| `npm run check` | Pass: 58 JavaScript files and 46 JSON files |
| `npm test` | Pass: 266/266 |
| `npm run acceptance:codex` | Pass in 405 ms: isolated marketplace add/install/list, four installed-launcher events, closed event, privacy scan, and cleanup |
| `npm run acceptance:claude` | Pass in 2.973 s: isolated local add/install/list/details, five installed-launcher events, closed event, privacy scan, and cleanup; provider delivery `not_tested` |
| `claude plugin validate . --strict` | Pass: root marketplace, plugin metadata, and five registered Claude hook phases |
| `npm pack --dry-run --json` | Pass: 111 files; portable plugin/CLI, both manifests, hook launcher, Claude marketplace, provider acceptance runners, delivery fixtures, and docs included; the GitHub-only `macos/` source is intentionally excluded |
| Unsigned `xcodebuild ... build-for-testing` | Pass locally: Debug app and test bundles, Info.plist, en/ko localization, and `assets`/`bin`/`src` resources |
| Native `AWFTests` | Pass locally: 39/39, 0 failures, 0 skips |
| Native UI runner | Inconclusive: worker did not materialize or launch AWF in 74 seconds; interrupted |

The repository lives under an iCloud-managed `Documents` directory on this validation Mac. One
unchanged image was present only as a `dataless` placeholder, so the first in-place Xcode resource
copy waited for materialization. Repeating the build from a temporary local staging tree populated
with the exact checked-in Git blob completed, and the latest native unit run passed 39/39. This
was treated as a local storage/materialization condition rather than a source-build failure.

An earlier live-consumer snapshot recorded 95.24% line, 83.24% branch, and 94.82% function
coverage, a clean dependency audit, and a passing package dry run. Those measurements were not
rerun for this native-preview snapshot and are not presented as current native release gates.

## Functional end-to-end results

### Read-only live-delivery witness

The CLI end-to-end test started
`integration verify codex --timeout 5 --json` against a private temporary data directory and
waited for its fixed stderr `AWF_READY` line. A separate real `scripts/hook.mjs` process then
received a Codex-shaped `UserPromptSubmit` event and published the audited semantic projection.
The verifier returned one closed stdout `observed` result and exited successfully in about 155 ms
under the full parallel test run.

The result exposed only the closed `ProviderDeliveryVerificationV1` fields and none of the
synthetic prompt, session, or turn canaries. Sentinel Codex and Claude configuration files under
the test's isolated provider home were byte-for-byte unchanged. Productive counterexamples confirm
that retained prompts, another provider's prompt, and same-provider tool progress do not satisfy
the witness. Generation rotation with monotonic sequence progress remains valid; reset or sequence
regression returns a closed unavailable result.

This proves the local baseline-to-hook-to-audited-reader implementation, not provider attestation.
The test deliberately invokes the worker itself. A user-owned live pass still requires a fresh
prompt from an already loaded and trusted provider session while the terminal watcher is running.

### Isolated provider acceptance

`npm run acceptance:codex` staged only the reviewed Codex plugin subset into a private temporary
tree and used an isolated Codex home. The real Codex plugin CLI added the temporary marketplace,
installed the plugin, and listed that installation. The runner found the installed launcher and
executed synthetic `UserPromptSubmit`, `PreToolUse`, and `PostToolUse` inputs through it.

The installed hooks produced closed Codex `LiveEventV1` records including a `prompt_contract`
incident. The bounded acceptance scan found none of the injected raw prompt, session, turn,
workspace, tool-use ID, tool-input, or tool-output canaries, and the temporary tree was removed.
Each raw value began and ended with a short per-field nonce marker. A regression persisted only the
first 20 bytes of prompt/input/output and correctly failed the privacy gate, while a productive
generic non-nonce counterexample passed. The runner did not call `/hooks`, change the user's Codex
configuration, approve hook trust, or observe provider-driven delivery, so those claims remain
pending.

The Claude runner used private temporary `HOME`, `CLAUDE_CONFIG_DIR`, workspace, and data
directories. Claude Code `2.1.207` added the local marketplace, installed the plugin at local
scope, and returned the expected list/details inventory. The runner then exercised the installed
launcher for `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and
observation-only `Stop`. All five closed semantic events were produced, raw canaries were absent,
and owned-root cleanup succeeded. Its public result fixes `providerDelivery` to `not_tested`; it
does not bypass source trust, `disableAllHooks`, or managed policy.

The runner validated that its parent was inside the system temp tree, created a fresh child itself,
and removed only that owned child. Counterexample tests preserved a caller-owned temp parent and
rejected the repository as a temp parent without changing it. Read-only provider probes also
received a closed environment allowlist; synthetic API-key and unrelated-secret variables were
absent from both synchronous and asynchronous probe runners. The shipped CLI/dashboard paths run
providers concurrently, and each provider's version/list steps share one three-second result
budget, including the case where a custom async runner never settles. Production default children
are hard-killed on timeout or dashboard shutdown; custom runners cannot be forcibly cancelled by
AWF.

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
- the provider endpoint and cards used a closed `ProviderIntegrationStatusV1` projection and
  separated provider installation from audited event activity;
- an engine-ready dashboard with no observed provider event remained in a waiting/attention state
  instead of presenting false-green active monitoring;
- only a new audited event arriving after dashboard startup could advance the corresponding
  activity to `observed`; retained pre-start spool and historical trace events could not;
- recent activity expired after five minutes without another new provider event;
- the no-argument dashboard started with an empty-but-connected live spool and required no
  recording;
- real hook publications appeared through status and SSE as prompt, tool, and incident events with
  semantic aliases only;
- source, empty/active state, stream health, coverage, and generation identity were represented by
  closed status fields;
- a rotation and reconnect emitted one generation-aware snapshot reset, and composite resume IDs
  prevented duplicate delivery;
- a forced busy publication changed coverage to incomplete even without a later event;
- writer races retained the last audited snapshot as stale, while corruption and invalid UTF-8
  produced degraded state without forwarding rejected bytes;
- expired events and their generation alias key were hidden and physically removed by dashboard
  maintenance;
- `dashboard <trace-id>` still served a separately audited historical trace;
- the page rendered meaningful content with no console errors or framework error overlay;
- signal state changed to `warn` and the tab title showed review state;
- compact sentinel mode opened and expanded again;
- light/dark mode and English/Korean switching worked;
- at a 1,280 px viewport, the trend and signal panels stayed at 684×220 and 486×220 instead of
  stretching down the page; automated language scans found no Korean UI copy in English mode and
  no English UI copy in Korean mode;
- an allowlisted image that never materialized returned the fixed `asset_unavailable` response
  after its bounded wait while the status endpoint remained responsive;
- browser output did not provide a truly transparent always-on desktop window. The new native
  source preview implements that presentation separately with an `NSPanel`.

### Native macOS developer preview

The checked-in Xcode project exposes `AWF`, `AWFTests`, and `AWFUITests` plus a shared scheme. The
unsigned Debug build:

- compiled the Swift 6 app for a macOS 13 deployment target;
- processed the explicit Info.plist and English/Korean localizations;
- copied the reviewed `assets/`, `bin/`, and `src/` trees into app resources;
- installed the transparent green guardian mark as the native app icon;
- linked the SwiftUI/AppKit menu bar and sentinel with the WebKit dashboard window; and
- required no third-party Swift package.

The native protocol boundary accepts a maximum 1,024-byte exact `DashboardReadyV1` line and
maximum 16 KiB exact `DashboardStatusV1` and `ProviderIntegrationStatusV1` responses. The status
client refuses redirects and the non-persistent `WKWebView` refuses navigation away from the exact
tokenized loopback URL. Swift does not receive raw prompts, hook objects, commands, outputs,
transcripts, source content, or detector state.

The local `AWFTests` target passed all 39 tests without skips. The runtime tests also cover the
minimum/newer Node boundary, old and malformed versions, inherited-`PATH` rejection, strict
bounded NVM discovery, and a bounded unresponsive probe. The
end-to-end native test resolved the worker from the built app resources,
launched it with a closed environment allowlist, parsed the bounded readiness line, fetched the
exact empty status and provider integration objects, and stopped the child. The minimized sentinel
stays yellow for retained or expired activity and turns green only when the provider contract
contains fresh `observed` evidence; high warnings still take precedence as red/critical. A direct
temporary-data launch also showed 0.0% CPU at a ten-second snapshot with about 96 MB RSS while its
Node child used about 55 MB; normal application quit removed both processes.

The native worker environment forwards only audited locale/configuration keys and builds a closed
executable search path for the ChatGPT-bundled Codex CLI, Homebrew, `/usr/local`, and safe
user-local install directories. A `HOME` containing a path separator cannot inject another search
entry.

This is still not native release acceptance. The UI target compiled, but Xcode remained at
“waiting for workers to materialize” for 74 seconds and never launched AWF, so the attempt was
interrupted rather than reported as passed or failed. All seven configured GitHub jobs pass on the
current PR head. The first Ubuntu hook benchmark attempt had a transient p95 of 195.751 ms while
the unchanged hot path's p50 was 52.339 ms; the failed-job rerun passed at 57.129 ms p95 without a
code or threshold change. Interactive UI automation on a working host, signed launch,
notarization, and clean-machine testing remain pending.

## Privacy checks

- A 15,113-event single-session trace passed the closed-schema audit.
- Export contained 15,113 lines and was 6,158,883 bytes.
- The export did not contain the synthetic raw prompt marker, command marker, session ID, or
  temporary workspace path.
- DetectorStateV4 persisted none of the injected workspace basename/path, file name/path, provider
  tool name, prompt, input, output, or source canaries.
- `LiveEventV1` accepts one exact object shape made only from closed enums, bounded numbers,
  rule/issue IDs, and a per-generation HMAC session alias. Unknown keys and synthetic raw prompt,
  input, output, path, file-name, and source canaries are rejected before publication.
- The live store uses mode `0700` directories and mode `0600` key, control, temporary, and event
  files in its fixtures.
- Concurrent synthetic publishers are serialized without duplicate sequence numbers; partial
  temporary and pending publications are recovered from audited event files.
- The live generation rotates at the configured event, byte, or age boundary. Production uses
  hard 4,096-event/8 MiB ceilings and a 24-hour age trigger on next access, with a new unlinkable
  HMAC alias key after rotation.
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

Each current sample directly launched the inner `/bin/sh -p` launcher and a fresh real Node hook
process. It therefore includes the inner shell, launcher validation/environment scrubbing, both
process creations, stdin JSON parsing, detector/state work, atomic local writes, stdout JSON, and
process exit. It excludes provider dispatch and Codex's outer inherited `$SHELL -lc`. Warmups were
excluded.

The earlier three-condition snapshot was:

| Condition | Samples | p50 | p95 | p99 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| No active semantic trace | 150 | 43.39 ms | 46.24 ms | 48.30 ms | 54.28 ms |
| Active semantic recording | 150 | 44.66 ms | 47.44 ms | 49.40 ms | 56.76 ms |
| Active trace already over 15,000 events | 100 | 45.17 ms | 47.58 ms | 50.46 ms | 52.73 ms |

The active recording added about 1.2 ms at p95 in that controlled comparison. Trace length did not
materially slow the hook because append does not reread the complete event file.

The CLI lazily imports the dashboard so every hook process does not parse the dashboard bundle or
load its images. Dashboard startup also no longer waits for image reads: each allowlisted image is
loaded and cached only on its first HTTP request. The latest `npm run benchmark:hook` rerun
measured the direct inner launcher plus real subprocess with both the always-on spool and an active
explicit semantic trace:

| Samples | Warmups | p50 | p95 | p99 | Max |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 10 | 50.225 ms | 54.614 ms | 57.059 ms | 57.800 ms |

The checked-in `npm run benchmark:live-spool` saturated one full 4,096-event generation before
forcing rotation:

| Condition | p50 | p95 | p99 | Max / rotation |
| --- | ---: | ---: | ---: | ---: |
| Semantic publish before rotation | 0.754 ms | 1.049 ms | 2.326 ms | 20.202 ms |
| Replace a full generation | — | — | — | 9.087 ms |

The steady-state gate is 100 ms p95 and the full-generation rotation gate is 1,000 ms. Both passed
on this machine.

The latest isolated `npm run benchmark:live-dashboard` rerun saturated the full 4,096-event
generation, started the real loopback server, read status repeatedly, forced rotation, observed the
SSE reset, and published concurrently. The initial full-generation audit took 143.181 ms:

| Warm status p95 | Concurrent publish p95 | Rotation | SSE reset visible | Drops |
| ---: | ---: | ---: | ---: | ---: |
| 0.980 ms | 7.946 ms | 8.913 ms | 476.955 ms | 0 |

The SSE visibility number includes the dashboard's bounded polling interval; it is not hook-path
latency. Warm status, concurrent publication, and rotation passed their checked-in limits.

The product target remains 100 ms p95. GitHub Actions enforces that budget on Ubuntu; the shared
macOS runner uses a separate 150 ms CI budget because cold Node process creation showed materially
higher runner variance. Local macOS performance is reported against the 100 ms product target.

Not yet covered:

- multi-hour concurrent live-spool lock latency under a real provider workload;
- large post-tool outputs;
- file-content hash work;
- slow or nearly full disks;
- Intel Macs and older supported macOS versions;
- performance on the minimum supported Node.js 18 runtime.

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
reproduction. The latest same-machine 15,000-event rerun produced:

| Events before append | Cold startup | Warm `/api/status` p95 | One-event append visible |
| ---: | ---: | ---: | ---: |
| 15,000 | 56.223 ms | 1.517 ms | 1.029 ms |

The cold audit intentionally remains proportional to trace size; steady-state polling no longer
rereads or reparses the whole file. This table remains the historical explicit-trace baseline.
The default dashboard now uses the separately measured bounded live-spool cursor described above.

Malformed loopback request targets now return a closed `400` response, active SSE connections no
longer prevent shutdown, trace rotation resets existing streams, and an invalid complete append
changes both the API and compact sentinel to an allowlisted red `degraded` state without exposing
the rejected bytes.

### P1 — No user-owned provider trust/live-delivery acceptance

The read-only reality gate resolves the earlier false-green visibility gap, and the isolated
provider runners validate package/install/direct-launcher paths. The bounded delivery witness now provides a
safe way to collect fresh semantic evidence, but it has not yet been run against a user-owned
provider session. The shell-path snapshot remains Codex `needs_install` and Claude Code
`not_detected`; the native closed search path reports both detected CLIs as `needs_install`.
Installation also does not imply that provider delivery works. A public compatibility claim still
requires Codex install/enable plus exact-hash `/hooks` review/trust, Claude source trust at
load/install plus read-only `/hooks` inspection, a live warning, and upgrade, repair, and uninstall
smoke tests in the actual provider applications.

### Partially resolved P1 — No distributable native macOS product

The source preview now implements the SwiftUI lifecycle, menu-bar status, restricted `WKWebView`,
app-owned dashboard launch, and true transparent sentinel. It remains a no-go for public
distribution because it still needs an installed Node.js runtime and has no start-at-login service,
signed nested runtime, Developer ID artifact, notarization, DMG, integration manager, update path,
or completed native acceptance matrix.

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

### Resolved transport and presentation gaps

Each supported hook now projects its detector result directly into the exact `LiveEventV1` shape
and attempts publication even when no trace recording is active. The private store uses
per-generation HMAC session aliases, atomic event-file rename under a short global lock, monotonic
sequence allocation across rotations until explicit purge, strict validation on write/read, and
recovery for interrupted temporary or pending publication. It rotates the whole generation at hard
4,096-event/8 MiB ceilings or when
the 24-hour age trigger is observed on next access. Busy or unavailable publication is fail-open
and cannot change the already-computed hook decision.

The presentation-read gap is now also closed. The default dashboard consumes only audited
`LiveEventV1` windows, while explicit traces remain the only format with user-invoked trace audit,
export, and replay commands. They can still be opened intentionally with
`dashboard <trace-id>`. The live reader uses stable control/event/control snapshots, no-following
private file reads, generation-scoped SSE identities, incremental validation plus a 30-second full
audit, and a one-second retention-only maintenance loop. It never takes the publish lock.

## Recommended next implementation order

1. ~~Fix the P0 session/trace ownership contract and add a two-session regression test.~~ Completed.
2. ~~Implement an incrementally audited cursor and session-aware dashboard projection.~~ Completed.
3. ~~Implement `LiveEventV1`, a bounded always-on spool independent of explicit recording.~~
   Completed.
4. ~~Connect the current dashboard projection to a generation-aware live-spool cursor.~~ Completed.
5. ~~Add a closed provider reality gate that separates engine readiness, installation, and audited
   activity.~~ Completed.
6. ~~Add isolated Codex and Claude marketplace/install/direct-launcher/privacy acceptance runners.~~ Completed
   and passed on this Mac.
7. ~~Observe the updated Node and unsigned native build/unit jobs on GitHub CI.~~ Current PR head
   passes all seven configured jobs.
8. ~~Add a bounded, read-only fresh-event witness without changing provider configuration.~~
   Completed and passed through a real CLI child plus real hook-worker child.
9. Add user-owned Codex exact-hash `/hooks` trust/live-delivery and Claude source-trust/install/live
   smoke tests.
10. ~~Build the SwiftUI/AppKit source shell, menu bar, and transparent sentinel.~~ Developer preview
   implemented; native UI acceptance remains pending.
11. Bundle/sign the worker and add install/repair/rollback/uninstall ownership tracking.
12. Sign, notarize, staple, and Gatekeeper-test GitHub artifacts.
13. Add optional actual-usage adapters and run the observe-only evaluation corpus.

Current release classification: **working Node research alpha plus unsigned native developer
preview; no-go as an installable macOS beta**.
