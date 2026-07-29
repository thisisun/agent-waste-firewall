# Design QA

Date: 2026-07-29

## Source visual truth

The supplied frames define the visual language rather than the dashboard layout:
fluorescent green, white paper/grid and near-black green surfaces, editorial
monospace typography, square rules, and a green statue as the observing motif.

- `/Users/un/Downloads/IMG_3131.PNG`
- `/Users/un/Downloads/IMG_3132.PNG`
- `/Users/un/Downloads/IMG_3133.PNG`
- `/Users/un/Downloads/IMG_3135.PNG`
- `assets/guardian-mark.webp`
- `assets/sentinel-eye-clear.webp`
- `assets/sentinel-eye-warn.webp`
- `assets/sentinel-eye-critical.webp`

The external references are not checked into the repository.

## Implementation evidence

- Local implementation:
  `http://127.0.0.1:43292/` with the dashboard's per-run token
- English default, light:
  `docs/design-evidence/awf-summary-dashboard-light.png`
- English default, dark:
  `docs/design-evidence/awf-summary-dashboard-dark.png`
- Korean secondary, dark:
  `docs/design-evidence/awf-summary-dashboard-dark-ko.png`
- Light source/implementation comparison:
  `/tmp/awf-summary-light-comparison-final.png`
- Dark source/implementation comparison:
  `/tmp/awf-summary-dark-comparison-final.png`
- Narrow graph before/after comparison:
  `/tmp/awf-graph-before-after.png`

The accepted desktop captures use a 1180 × 760 CSS viewport and a 1180 × 760
normalized raster. The narrow side-panel check uses a 509 × 987 CSS viewport.
Comparison boards place an 1180 × 760 contained reference beside the matching
1180 × 760 implementation in a 2360 × 760 raster.

## State checked

- Live, complete, healthy local source
- Warn protection mode with a high-severity repeated-failure signal
- 8 observed semantic events, 4 detected signals, and 3 potentially avoidable
  calls
- English mode with English-only product copy
- Korean mode with Korean-only product copy, excluding the AWF brand, the `EN`
  language control, and the audited anonymous session alias
- Light and dark themes
- Current-signal detail drawer open and closed
- 1180 × 760 one-screen desktop layout
- 509 × 987 responsive side-panel layout

## Interaction and accessibility checks

- Every metric and summary card opens a native right-side `dialog`.
- Opening the current-signal detail focuses `#detail-close`.
- Closing the dialog returns focus to the signal trigger.
- The language and theme controls update visible copy, document state, and
  pressed state.
- The desktop document height equals the 760 px viewport height.
- The 509 px responsive view has no horizontal overflow and permits vertical
  scrolling.
- Activity and session-load canvases remain bounded at 132 px and 64 px after
  repeated theme and language changes.
- Switching EN → 한국어 → EN keeps the prompt-contract score at `1 / 5`.
- Canvas charts have visible text readouts and accessible image labels.
- Browser runtime logs contain no warnings or errors.
- Raw prompts, commands, outputs, transcript text, and source content never
  enter the dashboard projection.

## Comparison findings and history

- Pass 1: the earlier oversized marketing line, “ONE SCREEN. ZERO BLIND
  SPOTS.”, consumed the masthead and repeated what the layout should prove.
- Fix: replace it with the functional `LIVE SESSION` title, keep the AWF brand
  eyebrow, and retain only a short locale-matched local/raw-free subline.
- Pass 2: the reduced masthead returns space to the charts and signal summary.
  All five overview panels remain visible at 1180 × 760.
- Pass 3, P1: at the 509 × 987 side-panel width, percentage-height canvases
  fed their device-pixel dimensions back into an auto grid row. The activity
  chart grew to 3136 px and the session-load chart to 850 px, hiding the
  remaining summary.
- Fix: replace percentage heights with bounded 96–132 px and 48–64 px tracks,
  use intrinsic grid rows, and reduce the responsive trend-panel minimum to
  210 px.
- Pass 4: the focused before/after comparison shows the chart contained within
  one card. The final measured heights are 132 px and 64 px, with no horizontal
  overflow.
- Pass 5, P2: the English masthead used a Korean subtitle while the Korean
  masthead used an English subtitle and eyebrow. Changing language also cleared
  the prompt-contract score because warning rendering replaced the independent
  prompt-coach state.
- Fix: localize all masthead, footer, event badge, live-time, degraded-state,
  and browser-title copy per locale. Decouple warning rendering from
  prompt-coach state.
- Pass 6: English visible text contains Korean only in the `한국어` selector.
  Korean visible text contains Latin characters only in the AWF brand, `EN`
  selector, and anonymous alias. The prompt score remains `1 / 5` through both
  language switches.
- The light comparison matches the reference's paper grid, hard editorial
  rules, green statue treatment, fluorescent accent, and restrained mono
  hierarchy.
- The dark comparison matches the reference's near-black green field and vivid
  green foreground without introducing pink or magenta.
- Accepted variance: the references use a bespoke display face. AWF keeps
  dependency-free system monospace fonts to preserve offline, local-first
  distribution.

## Final visual review

- Hierarchy: brand, functional session title, live status, four metrics, three
  graphs/summaries, and two action cards read in that order.
- Density: the desktop summary is complete without scrolling; details remain
  available on demand. The narrow view no longer lets either graph dominate
  the page.
- Color: light and dark modes use the requested green consistently; severity
  uses yellow/red only for state communication.
- Imagery: transparent statue and magnifying-glass assets remain crisp with no
  colored backing plate.
- Copy: English and Korean modes are internally consistent, and the removed
  slogan no longer appears in shipped dashboard copy.

final result: passed
