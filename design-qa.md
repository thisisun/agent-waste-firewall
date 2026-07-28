# Design QA

Date: 2026-07-28

## Source visual truth

The following 2556 × 1179 references define the art direction. They are visual
language references, not application wireframes, so the comparison targets
palette, typography, image treatment, contrast, spacing, and editorial rhythm
rather than literal component positions.

- External user-supplied reference, not checked in: `IMG_3131.PNG`
- External user-supplied reference, not checked in: `IMG_3132.PNG`
- External user-supplied reference, not checked in: `IMG_3133.PNG`
- External user-supplied reference, not checked in: `IMG_3135.PNG`
- `assets/sentinel-eye-clear.webp` (1254 × 1254, transparent WebP)
- `assets/sentinel-eye-warn.webp` (1254 × 1254, transparent WebP)
- `assets/sentinel-eye-critical.webp` (1254 × 1254, transparent WebP)

## Implementation evidence

- Implementation: `http://127.0.0.1:4329/`
- Light screenshot:
  `docs/design-evidence/awf-dashboard-light.jpg`
- Dark screenshot:
  `docs/design-evidence/awf-dashboard-dark.jpg`
- Light side-by-side comparison, retained locally but not distributed because
  it contains the external reference: `/tmp/awf-qa-light-comparison-final.png`
- Dark side-by-side comparison, retained locally but not distributed because
  it contains the external reference: `/tmp/awf-qa-dark-comparison-final.png`
- Expanded dashboard with the compact control:
  `docs/design-evidence/awf-expanded-compact-control.png`
- Compact review state:
  `docs/design-evidence/awf-compact-review.png`
- Compact critical state:
  `docs/design-evidence/awf-compact-critical.png`
- Critical source/implementation comparison:
  `docs/design-evidence/awf-critical-comparison.png`

The browser CSS viewport was 821 × 987 at device-pixel-ratio 2. The captured
browser content raster is 806 × 969. Each reference was proportionally resized
and center-cropped to 806 × 969 before it was placed next to the implementation
in a 1612 × 969 comparison image.

The compact-state browser viewport was 1280 × 720 with browser
`devicePixelRatio` 2. Browser screenshots were CSS-density normalized to
1280 × 720 for compact states and 1265 × 712 for the expanded page with its
scrollbar. The focused critical comparison downsamples the 1280 × 720
implementation to 632 × 356 and places it beside a 632 × 356 target frame
containing the 1254 × 1254 source asset at the same relative scale. The
combined evidence raster is 1264 × 420.

## States and interactions checked

- English is the default language and Korean is an explicit secondary option.
- Light is the default theme and dark is an explicit secondary option.
- Theme and language controls update their pressed state and visible copy.
- Korean mode updates the live warning and prompt-coach copy without revealing
  or retaining raw prompt content.
- The live status, event stream, warning panel, and prompt coach render realistic
  demo data.
- The `COMPACT` control leaves only the sentinel visible; selecting the sentinel
  restores the full dashboard.
- Medium severity produces the yellow `REVIEW` asset and title/favicon state.
- A repeated high-severity signal produces the red `CRITICAL` asset, localized
  title, and pulsing deep-red full background.
- English and Korean update the compact control, visible status, accessible
  announcement, and document title.
- The page has no browser-console errors and no horizontal overflow at the
  checked viewport.

## Full-view and focused comparison

Full-page light and dark captures were inspected alongside the matching source
frames in the saved comparison images. A focused inspection covered:

- the transparent guardian statue and magnifying glass in the hero;
- the white paper/grid surface and near-black green dark surface;
- the fluorescent emerald accent (`#00e58b`);
- the square editorial panels, dividers, and monospaced hierarchy;
- theme and language controls;
- warning, live-event, and prompt-coach density at tablet width.
- compact sentinel scale, transparent edges, eye legibility, status label,
  yellow/red state distinction, and deep-red critical background.

No pink or magenta pixels are used by the interface palette. The guardian mark
is a real transparent WebP asset, so it has no colored backdrop or CSS-drawn
substitute.

## Findings

- P0: none.
- P1: none.
- P2, pass 1: at an 821 px viewport, the mode panel inherited a 560 px maximum
  width and the warning/coach stack stayed in two narrow columns.
- Fix: the 860 px breakpoint now makes the mode panel full-width and collapses
  the warning/coach stack to one column.
- P2, pass 2: resolved. The mode panel measured 766 px, equal to its app
  container; the side stack measured one 766 px column; document and viewport
  widths matched, so there was no horizontal overflow.
- P3, accepted: the references include a bespoke techno display face. The
  implementation uses dependency-free system monospace fonts to preserve the
  local-first, offline-friendly distribution while matching the typewriter
  references closely.
- P3, residual test gap: the in-app browser's temporary viewport capability
  reported success but continued to render at 1280 × 720, so a separate mobile
  screenshot was not accepted as evidence. The compact sizing has explicit
  width/height breakpoints and automated DOM coverage, but a true mobile visual
  capture remains follow-up polish rather than a blocker for this minimized
  desktop-sidecar interaction.

## Compact sentinel comparison history

- Pass 1 asset review: the first red render used a magenta-adjacent key color
  that could leave a pink fringe after transparency removal.
- Fix: regenerate the red statue and magnifying glass against a green
  chroma-key field, then apply a soft matte and despill before export.
- Pass 2 evidence: `awf-critical-comparison.png` shows the final red
  asset and browser implementation together. The eye remains legible, the
  transparent edge has no pink halo, and the slight deep-red background
  difference is the intended critical pulse between `#7a0714` and `#b7152a`.
- Final code review found two non-visual P2 issues: the status endpoint exposed
  an unused user-defined recording label, and deduplicated escalation events
  temporarily inflated the live incident metric.
- Fix: remove the label from the browser payload and add a closed `0 | 1`
  `incidentCountDelta` projection so critical escalation still updates the
  sentinel without changing the server-owned count. Integration tests cover a
  sensitive label and the `[1, 1, 0, 0]` notified/deduplicated escalation
  sequence.
- P0/P1/P2 after pass 2: none.

## Final visual review

- Typography: clear English-first hierarchy, compact Korean subcopy, and
  readable mono labels.
- Spacing: large editorial whitespace in the hero, consistent panel insets, and
  a stable single-column tablet flow.
- Color: white/light and deep-green/dark surfaces use the requested fluorescent
  green consistently; pink is absent.
- Imagery: the original guardian mark is crisp, transparent, and sized for both
  brand and hero placements. The three compact sentinel assets are real
  transparent WebP images rather than CSS or SVG substitutes.
- Copy and accessibility: controls have localized labels and pressed states;
  the sentinel is a labeled button with a polite live announcement, descriptive
  alternate text, keyboard focus, and reduced-motion handling.

final result: passed
