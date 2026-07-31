# GitHub landscape and build-versus-reuse decision

Snapshot date: 2026-07-29 (Asia/Seoul)

This review asks a narrower question than “is there already a token dashboard?” There are several
good token dashboards. The useful question is whether an existing project already provides all of
the following:

1. live Codex and Claude Code command-hook observation;
2. progress-aware detection of repeated work while the agent is still running;
3. an immediate, actionable prompt-coaching response;
4. a native macOS sentinel;
5. a construction-time privacy boundary that never persists raw prompts, tool input/output,
   transcript text, source content, or raw hook JSON.

No inspected project satisfies that combination. Building AWF remains justified, but only
as a privacy-first live intervention layer. A generic historical token/cost dashboard would enter
an already mature category with little differentiation.

## Executive decision

Keep and harden the existing dependency-free hook/detector core. Build a thin native Swift shell
around a versioned semantic contract. Reuse selected MIT/Apache-2.0 patterns and tests, with
attribution, instead of forking a competing application.

The product boundary is:

> Detect observable no-progress loops in Codex and Claude Code, warn while they are happening, and
> suggest the smallest better next prompt—without recording what the user or agent said.

Exact token accounting remains an optional asynchronous adapter. It must not become a dependency
of the hot-path decision engine.

## Closest products

| Project | What it already does well | Conflict or missing capability | Decision |
| --- | --- | --- | --- |
| [CodeBurn](https://github.com/getagentseal/codeburn) | Multi-provider usage/cost analysis, waste reports, native Swift menu bar, Claude `PreToolUse` budget guard, strong tests | Reads raw session files; its main cache includes user messages, shell commands, and project paths; live guard is Claude-specific and budget-based rather than cross-provider progress detection | Primary product benchmark; selectively reuse MIT patterns, never its cache model |
| [TokenSave](https://github.com/aovestdipaperino/tokensave) | Local code-graph MCP, per-call savings estimates, live TUI, broad agent integration, and Claude hook steering | Persists indexed source bodies and paths; its intervention redirects discovery toward its own MCP rather than detecting general no-progress work | Strong adjacent competitor and benchmark; do not adopt its persistence boundary |
| [Token Savior](https://github.com/Mibayy/token-savior) | Claude/Codex hooks, code navigation, memory, Bash compaction, command rewriting, and waste-pattern reports | Captures tool output and prompt text in local SQLite; several pattern reports are retrospective; no native raw-free prompt coach | Closest functional overlap; benchmark hook and pattern fixtures without copying its storage model |
| [AgentPulse](https://github.com/jstuart0/agentpulse) | Live Claude/Codex fleet dashboard, WebSockets, search, orchestration, optional LLM watcher | SQLite/Postgres events store content, tool input/output, and raw payloads; transcript text is synchronized; AI watcher consumes tokens and normally evaluates handoff states rather than every hot-path tool call | Feature benchmark only; privacy core would require a rewrite |
| [ccusage](https://github.com/ccusage/ccusage) | Mature Rust adapters, exact token/cost aggregation, Claude streaming-message deduplication, Codex cumulative/fork/replay handling | Historical transcript/rollout reader, not a real-time loop guard or prompt coach | Use as a behavioral oracle or optional aggregate adapter |
| [CodexBar](https://github.com/steipete/CodexBar) | Mature macOS 14+ status-item lifecycle, adaptive refresh, errors/staleness, signing, notarization, updates | Broad credential, cookie, process, RPC, and local-session observation surface; no work-loop intervention | Primary native/release benchmark; selectively reuse MIT patterns |
| [Open Vibe Island](https://github.com/Octane0411/open-vibe-island) | Native SwiftUI/AppKit overlay, launch-at-login, hook installers, local bridge | Reads transcripts/previews; GPL-3.0 is incompatible with copying into the current Apache-2.0 project without relicensing | Architecture and UX reference only |
| [Claude Code Agent Monitor](https://github.com/hoangsonww/Claude-Code-Agent-Monitor) | Polished Electron dashboard, SQLite history, WebSocket updates, packaging | Claude-only, raw transcript/tool history, comparatively heavy always-on runtime | UX benchmark only |
| [Tokdash](https://github.com/JingbiaoMei/tokdash) | Fast incremental log cursor, local usage dashboard, careful loopback/Origin configuration | Historical raw log reader; no live causal intervention or prompt coach | Reuse cursor/security ideas, not its observation boundary |
| [ClaudeBar](https://github.com/tddworks/ClaudeBar) | SwiftUI provider/monitor structure and release automation | Repository claims MIT in its README but has no tracked license file; hook path forwards raw JSON to an unauthenticated loopback handler | Do not copy code until licensing is corrected |

### Naming collision

The original working name `TokenSaver` is too crowded for the public product name. Active adjacent
projects already use
[TokenSave](https://github.com/aovestdipaperino/tokensave) and
[Token Savior](https://github.com/Mibayy/token-savior); exact or near-exact GitHub names include
[Byggarepop/TokenSaver](https://github.com/Byggarepop/TokenSaver),
[shuaills/tokensaver](https://github.com/shuaills/tokensaver), and
[token-saver](https://github.com/ppgranger/token-saver). The unscoped
[`tokensaver` npm package](https://www.npmjs.com/package/tokensaver) is also already registered.

This is not a legal trademark conclusion. It is a search, package-resolution, and user-confusion
risk. The resulting public name is **AWF — Agent Waste Firewall**, with
`agent-waste-firewall` as the repository, package, and CLI identifier.

### Newly identified adjacent products

TokenSave and Token Savior make the generic “save coding-agent tokens” category even less
attractive than the initial survey suggested.

- TokenSave indexes source code into a local project database and records project paths plus
  per-tool savings globally. Its optional worldwide counter sends aggregate token counts and an
  IP-derived country unless disabled. This can be a valid local-code-intelligence design, but it
  is incompatible with AWF's no-source persistence boundary.
- Token Savior has the closest hook surface: its bundle covers Claude and Codex, and its pattern
  analysis recognizes sequences such as repeated discovery and insufficient edit context.
  However, its memory layer stores tool output and prompt text locally. That makes it unsuitable
  as the foundation for a monitor whose primary guarantee is that those values never persist.

Both are MIT-licensed and useful behavioral references. No source code from either project was
copied during this review.

### Why CodeBurn is not the foundation

CodeBurn is the closest competitor and should be treated seriously. At inspected commit
[`8578199`](https://github.com/getagentseal/codeburn/tree/85781999a5ea346e0344250487ff9c76e2ce5758):

- its Claude guard incrementally tails only newly appended transcript bytes, deduplicates streaming
  messages by message ID, warns at a soft cost cap, and denies at a hard cap;
- `Stop` only emits an observation when a costly session has produced no edit or commit;
- malformed input fails open;
- its Swift app treats the CLI as the source of truth and consumes a versioned JSON payload;
- its installer merges owned hooks without overwriting unrelated user settings.

Those are strong patterns. However, the application-wide session cache includes `userMessage`,
`bashCommands`, working directories, project paths, branch/PR metadata, tool sequences, and other
raw identifiers in `session-cache.v7.json`. See
[`src/session-cache.ts`](https://github.com/getagentseal/codeburn/blob/85781999a5ea346e0344250487ff9c76e2ce5758/src/session-cache.ts).
That is a legitimate local product choice, but it contradicts AWF's repository policy.
Forking CodeBurn and removing this assumption would touch its parser, cache, reports, optimize
engine, exports, and UI. It is not a shortcut to AWF's privacy contract.

### Why AgentPulse is not the foundation

AgentPulse's event schema explicitly stores `content`, `toolInput`, `toolResponse`, and
`rawPayload` for both SQLite and PostgreSQL. See
[`events.ts`](https://github.com/jstuart0/agentpulse/blob/2d4bb8a8169f2953e1f10ecb50a2775ae4921aa8/src/server/db/schema/core/events.ts).
It also polls transcript files and stores assistant text in the timeline. Its optional AI watcher
is useful for fleet orchestration, but it sends recent event context to a selected model and is
normally triggered around a handoff or idle point. AWF's detector must remain deterministic,
offline, and active before repeated tool work compounds.

AgentPulse remains a good benchmark for concurrent-session UX, health states, event fanout,
backpressure, and human-in-the-loop controls. Its raw-event database and remote relay are explicitly
out of scope for AWF.

Its checked-in Codex setup must also not be copied. At inspected commit `2d4bb8a`, the installer
generates a flat `type: "http"` hook. The current official Codex hook engine uses the event-map /
matcher-group manifest and executes command handlers; HTTP handler parity remains unshipped. See
Codex's
[`hook_config.rs`](https://github.com/openai/codex/blob/4f6eaf7af9d975b822d1d658ba1893d6d5a87646/codex-rs/config/src/hook_config.rs)
and [hook parity tracker #21753](https://github.com/openai/codex/issues/21753). AgentPulse can still
show Codex data through a separate rollout observer, so a populated dashboard is not proof that its
HTTP hook ran. AWF must retain command hooks and test real `UserPromptSubmit` and
`PreToolUse` delivery.

## Algorithm references

### Loop detection

- [OpenHands software-agent-sdk](https://github.com/OpenHands/software-agent-sdk) uses a bounded
  recent window, resets analysis at the latest user message, and checks same-action/result,
  repeated errors, monologue, and alternating patterns. Its useful lesson is bounded,
  prompt-scoped detectors with separate thresholds.
- [StrongDM Attractor](https://github.com/strongdm/attractor/blob/main/coding-agent-loop-spec.md)
  specifies tool-name/argument signatures and repeated pattern lengths. Its full-output host
  contract must not be adopted.
- [OpenLegion](https://github.com/openlegion-ai/openlegion) demonstrates graduated warning,
  blocking, and hard-cap thresholds, but its PolyForm Perimeter license prohibits use in a
  competing product. Treat the idea as prior art; copy no code or tests.

AWF already has the stronger privacy-compatible primitive: a bounded semantic signature,
result fingerprint, and monotonic `progressVersion`. Repetition is evaluated only within the
current progress version, so a productive edit/test/edit cycle is not treated as stuck work.
The next detector extension should cover `ABAB` and `ABCABC` tails using only those semantic hashes.
Each extension needs a positive fixture and a productive counterexample.

### Exact usage

ccusage is the preferred behavioral oracle for:

- Claude streaming entries where later copies replace earlier usage;
- parent/subagent and sidechain deduplication;
- Codex cumulative token counters converted into deltas;
- fork/replay duplicate suppression;
- model pricing and missing-price provenance.

Do not vendor its complete runtime into the command hook. A later opt-in adapter may execute an
installed `ccusage --offline --json` process and consume only a validated aggregate schema, or
independently implement the minimal token-only mappings with equivalent fixtures. Raw transcripts
must never be copied into AWF storage.

### Incremental file cursor and local server security

Tokdash provides useful tests for a source-file state containing mtime, size, signature, and a last
safe complete-line offset. An append can resume from that offset; truncation, rotation, or a changed
signature forces a cold parse. Its local server also validates loopback binding, `Host`,
scheme-aware `Origin`/`Referer`, and a process token. See its
[`usage_store.py`](https://github.com/JingbiaoMei/Tokdash/blob/5f24b5596d247e31825387553bd1f98b8dc5e21f/src/tokdash/usage_store.py)
and [`api.py`](https://github.com/JingbiaoMei/Tokdash/blob/5f24b5596d247e31825387553bd1f98b8dc5e21f/src/tokdash/api.py).

Only the cursor invariants and security regression ideas are reusable. Tokdash persists
`raw_json`, paths, and session IDs in SQLite, so its record schema cannot cross AWF's
semantic boundary.

### Dangerous-command protection

[CC Safety Net](https://github.com/kenryu42/cc-safety-net) already handles destructive-command
analysis across several coding CLIs, including wrappers and reordered flags. AWF should
detect coexistence and document compatibility instead of rebuilding a second shell-safety parser.
Its job is safety; AWF's job is waste and instruction quality.

## Native macOS reference stack

Use CodexBar as the principal reference for:

- `NSStatusItem` ownership and accessibility;
- `SMAppService.mainApp` launch-at-login registration;
- strict-concurrency state updates;
- stale/loading/error refresh policy;
- universal builds, helper placement, signing, notarization, and release checks.

Use Apple's `SMAppService` directly rather than adding a launch-at-login wrapper. Use
[Sparkle](https://github.com/sparkle-project/Sparkle) only when signed beta distribution needs
updates. Keep the first shell smaller than CodexBar: no provider OAuth, browser-cookie extraction,
process scraping, Full Disk Access, or quota endpoint integration is required to show semantic
waste warnings.

The reusable runtime boundary is the pattern, not a fork:

```text
dependency-free hook worker
  -> validated LiveEventV1 / HealthStatusV1
  -> versioned JSON or bounded local spool
  -> SwiftUI/AppKit menu bar + floating NSPanel
```

## License boundary

| Source | License status | Reuse rule |
| --- | --- | --- |
| CodeBurn, TokenSave, Token Savior, ccusage, CodexBar, AgentPulse, Tokdash, OpenHands SDK, CC Safety Net | MIT | Selected code may be adapted only with the original copyright and permission notice in `THIRD_PARTY_NOTICES.md` |
| StrongDM Attractor | Apache-2.0 | Compatible with this repository; retain notices and mark modifications |
| Open Vibe Island | GPL-3.0 | Do not copy code into the current Apache-2.0 product |
| OpenLegion | PolyForm Perimeter 1.0.1 | Do not copy code or tests for this competing product |
| ClaudeBar, Disler multi-agent observability | No usable tracked license found at review time | Do not copy code |

No third-party source code was copied during this review.

## Opportunity-cost estimate

These are rough engineering estimates for one experienced engineer, not measured delivery
commitments. They are intended to compare directions.

| Direction | Apparent shortcut | Hidden cost | Net decision |
| --- | --- | --- | --- |
| Fork CodeBurn | Historical usage, menu bar, detectors immediately | Remove raw cache assumptions, add Codex hot-path guard, replace product UX, carry a large upstream merge burden | Reject |
| Fork AgentPulse | Live multi-session dashboard and watcher immediately | Replace raw database/search/transcript sync, remove remote/orchestration surface, replace Bun/DB hot path, add native macOS shell | Reject |
| Rebuild all usage accounting | Full ownership | Relearn streaming/cumulative/fork deduplication and pricing edge cases | Reject; use ccusage as oracle |
| Rewrite detector core in Swift | Single-language app | Reimplement and cross-check the existing tested policy engine before gaining product value | Defer |
| Keep core + selective references | Preserves current privacy and latency properties | Requires a small, explicit IPC/spool contract and native shell | Adopt |

The selected references avoid approximately three to five engineering weeks:

- loop taxonomy and fixture design: about 1–2 days saved;
- native shell, status item, refresh, and release patterns: about 5–8 days saved;
- Sparkle release updater, when needed: about 1–2 days saved;
- compatibility with CC Safety Net instead of a new destructive-command parser: roughly 2–4
  weeks of avoided scope.

The estimate does not mean AWF is three to five weeks from release. Installed-provider acceptance
tests, a signed native app, false-positive evaluation, and optional actual-usage adapters still
require implementation. The bounded always-on transport and browser-side live consumer described
below were implemented after this research snapshot.

## Repository baseline at the start of implementation

The initial local validation snapshot is recorded in
[`VALIDATION-REPORT-2026-07-29.md`](./VALIDATION-REPORT-2026-07-29.md):

- dependency-free hook subprocess p95 remained below 48 ms in the tested cases;
- 89 tests passed before this milestone;
- the 15,003-event dashboard status path reached 121.39 ms p95 because it reread and audited the
  entire trace on every request;
- a workspace trace rejected a second session alias even though recording selection was
  workspace-scoped.

The first implementation milestone therefore fixes correctness and scaling before adding a native
shell:

1. allow multiple pseudonymous sessions in one explicitly recorded workspace trace while
   preserving global sequence and elapsed-time checks;
2. make current-warning projection session-aware;
3. replace repeated full dashboard reads with an incrementally audited cursor;
4. add multi-session, privacy, and long-trace regression/performance tests;
5. then implement the bounded always-on `LiveEventV1` spool described in
   [`MACOS-ARCHITECTURE.md`](./MACOS-ARCHITECTURE.md).

All five corrective steps and the generation-aware browser dashboard consumer are now implemented.
The linked report is the 2026-07-29 milestone snapshot; current measurements are recorded in
[`VALIDATION-REPORT-2026-07-30.md`](./VALIDATION-REPORT-2026-07-30.md). The values above remain
historical evidence for why the architecture changed.

## Go / no-go

**Go** for a focused open-source AWF:

- Codex and Claude Code command hooks;
- deterministic progress-aware live warnings;
- English-first, Korean-secondary prompt coaching;
- transparent yellow/red/critical native sentinel;
- raw-data non-persistence proven by closed schemas and fixtures.

**No-go** for a generic “tokens used today” dashboard, a transcript viewer, or a remote fleet
orchestrator. Those categories already have mature open-source projects and would dilute the
privacy-first intervention advantage.

## 한국어 요약

일반적인 토큰·비용 대시보드는 이미 CodeBurn, ccusage, CodexBar가 잘 만들고 있습니다.
그 방향을 그대로 따라가면 새로 만들 이유가 약합니다.
또한 같은 분야에 TokenSave, Token Savior와 여러 `TokenSaver` 저장소가 이미 있어
기존 작업명 `TokenSaver`는 공개 제품명으로 쓰지 않는 편이 좋습니다. 공개 이름은
**AWF — Agent Waste Firewall**로 결정했습니다.

AWF는 다음 다섯 가지에 집중할 때 가치가 있습니다.

1. Codex와 Claude Code를 동시에 실시간 감시한다.
2. 단순 호출 횟수가 아니라 실제 진행이 없는 반복을 판정한다.
3. 문제가 생긴 순간 다음에 넣을 프롬프트를 제안한다.
4. macOS 메뉴바와 투명한 감시 아이콘으로 노랑·빨강·심각 상태를 즉시 보여준다.
5. 프롬프트, 명령, 출력, 소스, 트랜스크립트 원문을 저장하지 않는다.

기존 프로젝트를 포크하지 않고, CodeBurn과 CodexBar의 네이티브/배포 패턴,
ccusage의 토큰 중복 제거 규칙, OpenHands와 Attractor의 루프 테스트 아이디어만
라이선스 조건에 맞춰 선택적으로 참고하는 것이 시간과 완성도 면에서 가장 좋습니다.
