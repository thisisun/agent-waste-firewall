export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en" data-theme="light" data-view="expanded" data-signal="clear">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <meta name="referrer" content="no-referrer">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    >
    <title>AWF — Agent Waste Firewall — Live guidance</title>
    <link
      id="dashboard-favicon"
      rel="icon"
      type="image/webp"
      href="/assets/sentinel-eye-clear.webp"
    >
    <link rel="stylesheet" href="/dashboard.css">
    <script src="/dashboard.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#main" data-i18n="skipLink">Skip to main content</a>
    <div class="app-shell">
      <header class="topbar">
        <a
          class="brand"
          href="#"
          aria-label="AWF — Agent Waste Firewall dashboard"
          data-i18n-aria-label="brandLabel"
        >
          <img
            class="brand-mark"
            src="/assets/guardian-mark.webp"
            alt=""
            width="52"
            height="52"
          >
          <span class="brand-copy">
            <strong>AWF</strong>
            <small data-i18n="brandSubtitle">Local live guidance</small>
          </span>
        </a>

        <div class="topbar-actions">
          <button
            id="view-toggle"
            class="view-toggle"
            type="button"
            aria-controls="main"
            aria-expanded="true"
            aria-label="Switch to compact sentinel"
          >
            <span id="view-toggle-label">COMPACT</span>
          </button>
          <div
            class="theme-toggle"
            role="group"
            aria-label="Color theme"
            data-i18n-aria-label="themeLabel"
          >
            <button
              type="button"
              data-theme-option="light"
              aria-pressed="true"
              data-i18n="themeLight"
            >LIGHT</button>
            <button
              type="button"
              data-theme-option="dark"
              aria-pressed="false"
              data-i18n="themeDark"
            >DARK</button>
          </div>
          <div
            class="language-toggle"
            role="group"
            aria-label="Language"
            data-i18n-aria-label="languageLabel"
          >
            <button type="button" data-language="en" aria-pressed="true">EN</button>
            <button type="button" data-language="ko" aria-pressed="false">한국어</button>
          </div>
          <div
            class="session-state"
            aria-label="Monitor connection status"
            data-i18n-aria-label="connectionAria"
          >
            <span class="connection" data-connection="connecting">
              <span class="connection-dot" aria-hidden="true"></span>
              <span id="connection-label">Connecting</span>
            </span>
            <span id="session-alias" class="session-alias" hidden></span>
          </div>
        </div>
      </header>

      <main id="main">
        <section class="hero" aria-labelledby="dashboard-title">
          <div class="hero-copy-block">
            <p class="eyebrow" data-i18n="heroEyebrow">LIVE AGENT SIDECAR</p>
            <h1 id="dashboard-title">
              <span data-i18n="heroTitleOne">WATCH THE WORK.</span>
              <span class="hero-accent" data-i18n="heroTitleTwo">STOP THE LOOP.</span>
            </h1>
            <p class="hero-copy" data-i18n="heroCopy">
              Observe semantic signals from Codex and Claude Code without retaining raw content.
            </p>
          </div>

          <figure class="guardian-figure">
            <figcaption class="guardian-tag" data-i18n="heroTag">LIVE / GUARDIAN 01</figcaption>
            <img
              class="guardian-art"
              src="/assets/guardian-mark.webp"
              alt=""
              width="512"
              height="512"
            >
          </figure>

          <div class="mode-panel" aria-labelledby="mode-title">
            <div class="mode-heading">
              <span id="mode-title" data-i18n="modeTitle">Current protection mode</span>
              <strong id="active-mode-label">Observe</strong>
            </div>
            <div
              class="mode-track"
              role="list"
              aria-label="Protection mode levels"
              data-i18n-aria-label="modeAria"
            >
              <span class="mode-chip" data-mode="observe" role="listitem">
                <span aria-hidden="true">01</span>
                <b data-i18n="modeObserve">Observe</b>
              </span>
              <span class="mode-chip" data-mode="warn" role="listitem">
                <span aria-hidden="true">02</span>
                <b data-i18n="modeWarn">Warn</b>
              </span>
              <span class="mode-chip" data-mode="block" role="listitem">
                <span aria-hidden="true">03</span>
                <b data-i18n="modeBlock">Block</b>
              </span>
            </div>
            <p id="mode-description" class="mode-description">
              Record signals without intervening in the agent's work.
            </p>
          </div>
        </section>

        <section
          class="metrics"
          aria-label="Session summary"
          data-i18n-aria-label="metricsAria"
        >
          <article class="metric-card">
            <span class="metric-label" data-i18n="metricEvents">Observed events</span>
            <strong id="metric-events" class="metric-value">0</strong>
            <span class="metric-unit" data-i18n="unitEvents">events</span>
          </article>
          <article class="metric-card">
            <span class="metric-label" data-i18n="metricIncidents">Detected signals</span>
            <strong id="metric-incidents" class="metric-value">0</strong>
            <span class="metric-unit" data-i18n="unitIncidents">incidents</span>
          </article>
          <article class="metric-card accent-card">
            <span class="metric-label" data-i18n="metricAvoidable">Potentially avoidable calls</span>
            <strong id="metric-avoidable" class="metric-value">0</strong>
            <span class="metric-unit" data-i18n="unitCalls">calls</span>
          </article>
          <article class="metric-card">
            <span class="metric-label" data-i18n="metricElapsed">Observed time</span>
            <strong id="metric-elapsed" class="metric-value">00:00</strong>
            <span class="metric-unit" data-i18n="unitElapsed">elapsed</span>
          </article>
        </section>

        <div class="content-grid">
          <section class="panel timeline-panel" aria-labelledby="timeline-title">
            <div class="panel-heading">
              <div>
                <p class="eyebrow" data-i18n="streamEyebrow">SEMANTIC STREAM</p>
                <h2 id="timeline-title" data-i18n="timelineTitle">Live workstream</h2>
              </div>
              <span class="live-pill">
                <span aria-hidden="true"></span><b data-i18n="liveLabel">LIVE</b>
              </span>
            </div>
            <ol id="timeline-list" class="timeline" aria-live="polite" aria-relevant="additions">
              <li id="timeline-empty" class="timeline-empty">
                <span class="empty-orbit" aria-hidden="true"></span>
                <strong data-i18n="timelineEmptyTitle">Waiting for the first semantic event</strong>
                <span data-i18n="timelineEmptyCopy">Raw commands and outputs never reach this screen.</span>
              </li>
            </ol>
          </section>

          <aside
            class="side-stack"
            aria-label="Current guidance"
            data-i18n-aria-label="guidanceAria"
          >
            <section
              id="warning-card"
              class="panel warning-card"
              data-severity="none"
              aria-labelledby="warning-heading"
              aria-live="assertive"
            >
              <div class="warning-topline">
                <p class="eyebrow" data-i18n="signalEyebrow">CURRENT SIGNAL</p>
                <span id="warning-attribution" class="attribution-badge" hidden></span>
              </div>
              <div id="signal-index" class="signal-index" aria-hidden="true">STATUS / CLEAR</div>
              <h2 id="warning-heading">No current warning</h2>
              <p id="warning-explanation">
                No repetition signal is currently blocking progress.
              </p>
              <div id="warning-action" class="warning-action">
                Continue observing semantic signals until the work changes.
              </div>
              <span id="warning-occurrences" class="occurrence-badge" hidden></span>
            </section>

            <section class="panel coach-card" aria-labelledby="coach-title">
              <div class="panel-heading compact-heading">
                <div>
                  <p class="eyebrow" data-i18n="coachEyebrow">PROMPT COACH</p>
                  <h2 id="coach-title" data-i18n="coachTitle">A request structure that reduces waste</h2>
                </div>
                <button id="copy-template" class="copy-button" type="button">
                  Copy
                </button>
              </div>
              <p id="coach-status" class="coach-status">
                Fill in all five items to keep the task on course.
              </p>
              <dl class="prompt-contract">
                <div data-contract="target">
                  <dt data-i18n="contractTargetTitle">Task &amp; scope</dt>
                  <dd data-i18n="contractTargetCopy">What to change and what must remain untouched</dd>
                </div>
                <div data-contract="success">
                  <dt data-i18n="contractSuccessTitle">Definition of done</dt>
                  <dd data-i18n="contractSuccessCopy">An observable result that proves completion</dd>
                </div>
                <div data-contract="verify">
                  <dt data-i18n="contractVerifyTitle">Verification</dt>
                  <dd data-i18n="contractVerifyCopy">A test, build, or manual check</dd>
                </div>
                <div data-contract="stop">
                  <dt data-i18n="contractStopTitle">Stop condition</dt>
                  <dd data-i18n="contractStopCopy">Retry limit and when to report the blocker</dd>
                </div>
                <div data-contract="conflict">
                  <dt data-i18n="contractConflictTitle">Authority &amp; questions</dt>
                  <dd data-i18n="contractConflictCopy">Choices that need approval and forbidden actions</dd>
                </div>
              </dl>
              <pre id="prompt-template" class="prompt-template" tabindex="0">Task: [what to change]
Scope: [target files/features and explicit exclusions]
Done when: [observable result]
Verify with: [test, build, or manual check]
Stop when: report and stop after the same failure repeats twice</pre>
              <span id="copy-feedback" class="sr-only" role="status" aria-live="polite"></span>
            </section>
          </aside>
        </div>

        <section class="privacy-note" aria-labelledby="privacy-title">
          <span class="privacy-kicker" data-i18n="privacyKicker">LOCAL / RAW-FREE</span>
          <div>
            <h2 id="privacy-title" data-i18n="privacyTitle">On this device, without raw content</h2>
            <p data-i18n="privacyCopy">
              Prompts, commands, outputs, source code, and absolute paths are never
              received or displayed. This view uses only approved semantic categories,
              numbers, and session aliases.
            </p>
          </div>
          <span class="local-only" data-i18n="localOnly">LOCAL ONLY</span>
        </section>
      </main>

      <footer>
        <span>AWF — Agent Waste Firewall</span>
        <span data-i18n="footerCopy">Data moves only between this browser and the local process.</span>
      </footer>
    </div>

    <button
      id="compact-sentinel"
      class="compact-sentinel"
      type="button"
      data-signal="clear"
      aria-label="Clear — expand full dashboard"
    >
      <img
        id="sentinel-image"
        src="/assets/sentinel-eye-clear.webp"
        alt=""
        width="1254"
        height="1254"
      >
      <span id="sentinel-status" aria-hidden="true">CLEAR</span>
      <span id="sentinel-live" class="sr-only" role="status" aria-live="assertive">
        No current waste signal.
      </span>
    </button>
    <noscript>Enable JavaScript on this local page to use live guidance.</noscript>
  </body>
</html>
`;

export const DASHBOARD_CSS = String.raw`:root {
  color-scheme: light dark;
  --bg: #f2f4ee;
  --bg-deep: #e6eadf;
  --surface: rgba(255, 255, 252, 0.78);
  --surface-solid: #fbfcf7;
  --surface-soft: rgba(236, 240, 229, 0.7);
  --ink: #171a18;
  --muted: #677067;
  --line: rgba(29, 38, 30, 0.12);
  --line-strong: rgba(29, 38, 30, 0.2);
  --lime: #b9e657;
  --lime-deep: #477409;
  --teal: #1f8773;
  --amber: #e9a33b;
  --red: #d95c55;
  --blue: #5a82d8;
  --shadow: 0 22px 64px rgba(31, 42, 32, 0.09);
  --radius-xl: 28px;
  --radius-lg: 20px;
  --radius-md: 14px;
  --font-sans: Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI",
    "Noto Sans KR", sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

* {
  box-sizing: border-box;
}

html {
  min-width: 300px;
  background: var(--bg);
  scroll-behavior: smooth;
}

body {
  min-height: 100vh;
  margin: 0;
  color: var(--ink);
  background:
    radial-gradient(circle at 6% 0%, rgba(185, 230, 87, 0.24), transparent 30rem),
    radial-gradient(circle at 95% 30%, rgba(31, 135, 115, 0.11), transparent 30rem),
    linear-gradient(155deg, var(--bg) 0%, var(--bg-deep) 100%);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}

button,
a {
  font: inherit;
}

button:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
  outline: 3px solid rgba(31, 135, 115, 0.42);
  outline-offset: 3px;
}

.skip-link {
  position: fixed;
  z-index: 100;
  top: 12px;
  left: 12px;
  padding: 9px 13px;
  color: #fff;
  background: #171a18;
  border-radius: 10px;
  transform: translateY(-160%);
}

.skip-link:focus {
  transform: translateY(0);
}

.app-shell {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
}

.topbar {
  min-height: 82px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid var(--line);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  position: relative;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(62, 101, 19, 0.25);
  border-radius: 13px;
  background: linear-gradient(145deg, #d6f786, var(--lime));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55);
}

.brand-mark::before,
.brand-mark span {
  content: "";
  display: block;
  border: 2px solid #284411;
  border-radius: 50%;
}

.brand-mark::before {
  width: 17px;
  height: 17px;
}

.brand-mark span {
  position: absolute;
  width: 5px;
  height: 5px;
  background: #284411;
}

.brand-copy {
  display: grid;
  line-height: 1.2;
}

.brand-copy strong {
  font-size: 14px;
  letter-spacing: -0.01em;
}

.brand-copy small {
  margin-top: 4px;
  color: var(--muted);
  font-size: 11px;
}

.session-state,
.connection {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.topbar-actions {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
}

.language-toggle {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-soft);
}

.language-toggle button {
  min-width: 38px;
  padding: 4px 7px;
  color: var(--muted);
  border: 0;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  font-weight: 750;
}

.language-toggle button[aria-pressed="true"] {
  color: var(--ink);
  background: var(--surface-solid);
  box-shadow: 0 1px 5px rgba(31, 42, 32, 0.09);
}

.session-state {
  min-width: 0;
  justify-content: flex-end;
}

.connection {
  color: var(--muted);
  font-size: 13px;
  font-weight: 650;
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 0 4px rgba(233, 163, 59, 0.13);
}

.connection[data-connection="connected"] .connection-dot {
  background: var(--teal);
  box-shadow: 0 0 0 4px rgba(31, 135, 115, 0.13);
}

.connection[data-connection="offline"] .connection-dot {
  background: var(--red);
  box-shadow: 0 0 0 4px rgba(217, 92, 85, 0.13);
}

.connection[data-connection="degraded"] .connection-dot {
  background: var(--red);
  box-shadow: 0 0 0 4px rgba(217, 92, 85, 0.13);
}

.connection[data-connection="reconnecting"] .connection-dot {
  animation: pulse 1.5s ease-in-out infinite;
}

.session-alias {
  max-width: 180px;
  overflow: hidden;
  padding: 4px 8px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 8px;
  font: 11px/1.3 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

main {
  padding: 54px 0 26px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(310px, 0.65fr);
  gap: clamp(30px, 6vw, 84px);
  align-items: end;
}

.eyebrow {
  margin: 0 0 10px;
  color: var(--lime-deep);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

h1,
h2,
p {
  overflow-wrap: break-word;
}

h1 {
  max-width: 720px;
  margin: 0;
  font-size: clamp(36px, 5.4vw, 65px);
  line-height: 1.05;
  letter-spacing: -0.055em;
}

.hero-copy {
  max-width: 570px;
  margin: 22px 0 0;
  color: var(--muted);
  font-size: 16px;
}

.mode-panel {
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.mode-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  color: var(--muted);
  font-size: 12px;
}

.mode-heading strong {
  color: var(--ink);
  font-size: 18px;
}

.mode-track {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-top: 17px;
}

.mode-chip {
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 10px 6px;
  color: var(--muted);
  border: 1px solid transparent;
  border-radius: 11px;
  background: var(--surface-soft);
  font-size: 12px;
  font-weight: 700;
}

.mode-chip span {
  font: 9px/1.2 var(--font-mono);
  opacity: 0.6;
}

.mode-chip b,
.live-pill b {
  font: inherit;
}

.mode-chip[aria-current="true"] {
  color: #22370d;
  border-color: rgba(71, 116, 9, 0.2);
  background: var(--lime);
}

.mode-description {
  min-height: 38px;
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin: 36px 0 18px;
}

.metric-card {
  position: relative;
  min-width: 0;
  padding: 18px 20px 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: 0 12px 35px rgba(31, 42, 32, 0.055);
}

.metric-card::after {
  content: "";
  position: absolute;
  top: 18px;
  right: 18px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line-strong);
}

.accent-card::after {
  background: var(--lime-deep);
}

.metric-label,
.metric-unit {
  display: block;
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.metric-value {
  display: block;
  margin: 8px 0 3px;
  font-size: clamp(27px, 3vw, 36px);
  line-height: 1;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}

.metric-unit {
  font: 9px/1.2 var(--font-mono);
  text-transform: uppercase;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.42fr) minmax(330px, 0.78fr);
  gap: 18px;
  align-items: start;
}

.panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.timeline-panel {
  min-height: 664px;
  padding: 26px 28px;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.panel-heading h2,
.warning-card h2,
.privacy-note h2 {
  margin: 0;
  font-size: 20px;
  line-height: 1.25;
  letter-spacing: -0.025em;
}

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  color: var(--teal);
  border: 1px solid rgba(31, 135, 115, 0.2);
  border-radius: 999px;
  font: 9px/1 var(--font-mono);
}

.live-pill span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.8s ease-in-out infinite;
}

.timeline {
  max-height: 568px;
  margin: 25px 0 0;
  padding: 0 4px 0 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-color: var(--line-strong) transparent;
}

.timeline-empty {
  min-height: 460px;
  display: grid;
  place-content: center;
  justify-items: center;
  color: var(--muted);
  text-align: center;
}

.timeline-empty strong {
  margin-top: 20px;
  color: var(--ink);
  font-size: 14px;
}

.timeline-empty span:last-child {
  margin-top: 6px;
  font-size: 12px;
}

.empty-orbit {
  width: 60px;
  height: 60px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background:
    radial-gradient(circle, var(--lime) 0 5px, transparent 6px),
    radial-gradient(circle, transparent 0 19px, var(--line) 20px 21px, transparent 22px);
  animation: breathe 3s ease-in-out infinite;
}

.timeline-item {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  padding: 13px 0;
  border-top: 1px solid var(--line);
}

.timeline-item::before {
  content: "";
  position: absolute;
  left: 16px;
  top: 47px;
  bottom: -14px;
  width: 1px;
  background: var(--line);
}

.timeline-item:last-child::before {
  display: none;
}

.event-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface-solid);
  font: 700 10px/1 var(--font-mono);
}

.timeline-item[data-kind="incident"] .event-mark,
.timeline-item[data-kind="decision"] .event-mark {
  color: #764312;
  border-color: rgba(233, 163, 59, 0.3);
  background: rgba(233, 163, 59, 0.14);
}

.timeline-item[data-kind="progress"] .event-mark {
  color: var(--teal);
  border-color: rgba(31, 135, 115, 0.22);
  background: rgba(31, 135, 115, 0.1);
}

.event-copy {
  min-width: 0;
}

.event-copy strong {
  display: block;
  font-size: 13px;
  line-height: 1.4;
}

.event-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 9px;
  align-items: center;
  margin-top: 5px;
  color: var(--muted);
  font-size: 10px;
}

.event-alias {
  max-width: 210px;
  overflow: hidden;
  font: 10px/1.3 var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-time {
  padding-top: 3px;
  color: var(--muted);
  font: 10px/1.3 var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.side-stack {
  display: grid;
  gap: 18px;
}

.warning-card {
  position: relative;
  overflow: hidden;
  padding: 24px;
}

.warning-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--teal);
}

.warning-card[data-severity="medium"]::before {
  background: var(--amber);
}

.warning-card[data-severity="high"]::before {
  background: var(--red);
}

.warning-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.attribution-badge,
.occurrence-badge {
  display: inline-flex;
  width: fit-content;
  padding: 4px 7px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-soft);
  font-size: 9px;
  font-weight: 750;
}

.warning-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  margin: 14px 0 17px;
  color: var(--teal);
  border-radius: 13px;
  background: rgba(31, 135, 115, 0.11);
  font-size: 17px;
  font-weight: 800;
}

.warning-card[data-severity="medium"] .warning-icon {
  color: #99570f;
  background: rgba(233, 163, 59, 0.14);
}

.warning-card[data-severity="high"] .warning-icon {
  color: #a93d37;
  background: rgba(217, 92, 85, 0.14);
}

.warning-card > p:not(.eyebrow) {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.warning-action {
  margin-top: 16px;
  padding: 12px 13px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-soft);
  font-size: 12px;
  font-weight: 650;
}

.occurrence-badge {
  margin-top: 12px;
}

.coach-card {
  padding: 24px;
}

.compact-heading {
  align-items: center;
}

.copy-button {
  padding: 7px 11px;
  color: var(--ink);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.copy-button:hover {
  background: var(--surface-soft);
}

.coach-status {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.prompt-contract {
  display: grid;
  gap: 7px;
  margin: 16px 0;
}

.prompt-contract > div {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: var(--surface-soft);
}

.prompt-contract > div.needs-attention {
  border-color: rgba(233, 163, 59, 0.36);
  background: rgba(233, 163, 59, 0.1);
}

.prompt-contract dt {
  font-size: 11px;
  font-weight: 750;
}

.prompt-contract dd {
  margin: 0;
  color: var(--muted);
  font-size: 10px;
}

.prompt-template {
  margin: 0;
  padding: 13px;
  overflow-x: auto;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(18, 25, 20, 0.045);
  font: 10px/1.72 var(--font-mono);
  white-space: pre-wrap;
}

.privacy-note {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  margin-top: 18px;
  padding: 20px 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: rgba(24, 32, 25, 0.045);
}

.privacy-note h2 {
  font-size: 14px;
}

.privacy-note p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 11px;
}

.privacy-lock {
  position: relative;
  width: 34px;
  height: 31px;
  border: 2px solid var(--teal);
  border-radius: 8px;
}

.privacy-lock::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 13px;
  left: 7px;
  top: -12px;
  border: 2px solid var(--teal);
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
}

.local-only {
  color: var(--teal);
  font: 700 9px/1 var(--font-mono);
  letter-spacing: 0.12em;
}

footer {
  min-height: 76px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  color: var(--muted);
  border-top: 1px solid var(--line);
  font-size: 10px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

[hidden] {
  display: none !important;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes breathe {
  0%,
  100% {
    transform: scale(0.96);
  }
  50% {
    transform: scale(1.04);
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121713;
    --bg-deep: #0c110d;
    --surface: rgba(27, 35, 29, 0.8);
    --surface-solid: #1b231d;
    --surface-soft: rgba(44, 56, 46, 0.7);
    --ink: #f2f5ee;
    --muted: #a3ada3;
    --line: rgba(223, 235, 218, 0.11);
    --line-strong: rgba(223, 235, 218, 0.2);
    --lime-deep: #b9e657;
    --shadow: 0 24px 70px rgba(0, 0, 0, 0.22);
  }

  .mode-chip[aria-current="true"] {
    color: #20330e;
  }

  .prompt-template {
    background: rgba(0, 0, 0, 0.16);
  }
}

@media (max-width: 900px) {
  .hero,
  .content-grid {
    grid-template-columns: 1fr;
  }

  .hero {
    align-items: stretch;
  }

  .mode-panel {
    max-width: 560px;
  }

  .timeline-panel {
    min-height: 520px;
  }

  .timeline-empty {
    min-height: 320px;
  }

  .timeline {
    max-height: 470px;
  }

  .side-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .app-shell {
    width: min(100% - 24px, 560px);
  }

  .topbar {
    min-height: 70px;
  }

  .brand-copy small,
  .session-alias {
    display: none;
  }

  .topbar-actions {
    gap: 8px;
  }

  .language-toggle button {
    min-width: 34px;
    padding-inline: 5px;
  }

  main {
    padding-top: 38px;
  }

  h1 {
    font-size: clamp(35px, 12vw, 52px);
  }

  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .side-stack {
    grid-template-columns: 1fr;
  }

  .timeline-panel,
  .warning-card,
  .coach-card {
    padding: 20px;
    border-radius: 22px;
  }

  .privacy-note {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .local-only {
    grid-column: 2;
  }

  footer {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }
}

@media (max-width: 420px) {
  .topbar {
    align-items: flex-start;
    padding: 13px 0;
  }

  .topbar-actions {
    align-items: flex-end;
    flex-direction: column;
  }

  .brand-copy strong {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mode-panel {
    padding: 17px;
  }

  .metric-card {
    padding: 15px;
  }

  .timeline-item {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .event-time {
    grid-column: 2;
    padding-top: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
  }
}

/* Editorial guardian system — reference-led redesign. */
:root,
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f8f8f4;
  --bg-deep: #f8f8f4;
  --surface: rgba(248, 248, 244, 0.92);
  --surface-solid: #f8f8f4;
  --surface-soft: rgba(17, 23, 19, 0.035);
  --ink: #111713;
  --muted: #59645d;
  --line: rgba(17, 23, 19, 0.18);
  --line-strong: rgba(17, 23, 19, 0.38);
  --lime: #00e58b;
  --lime-deep: #008d57;
  --teal: #00a968;
  --amber: #b86a00;
  --red: #bc3f35;
  --blue: #356eb9;
  --shadow: none;
  --radius-xl: 0;
  --radius-lg: 0;
  --radius-md: 0;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR",
    sans-serif;
  --font-mono: "SFMono-Regular", "Roboto Mono", "Noto Sans Mono CJK KR",
    Consolas, "Liberation Mono", monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #001408;
  --bg-deep: #001408;
  --surface: rgba(4, 31, 17, 0.96);
  --surface-solid: #061f12;
  --surface-soft: rgba(234, 255, 242, 0.055);
  --ink: #effff5;
  --muted: #93aa9b;
  --line: rgba(225, 255, 237, 0.18);
  --line-strong: rgba(225, 255, 237, 0.38);
  --lime: #00e58b;
  --lime-deep: #00e58b;
  --teal: #00e58b;
  --amber: #ffc16b;
  --red: #ff8177;
  --blue: #8eb9ff;
}

html {
  background: var(--bg);
}

body {
  color: var(--ink);
  background: var(--bg);
  background-image: url("/assets/paper-grid.webp");
  background-position: top center;
  background-repeat: repeat;
  background-size: 768px 768px;
  font-family: var(--font-sans);
  font-size: 15px;
}

:root[data-theme="dark"] body {
  background-image: none;
}

button:focus-visible,
a:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--lime);
  outline-offset: 3px;
}

.skip-link {
  color: #001408;
  background: var(--lime);
  border-radius: 0;
  font: 700 11px/1 var(--font-mono);
  letter-spacing: 0.06em;
}

.app-shell {
  width: min(1420px, calc(100% - 64px));
}

.topbar {
  min-height: 96px;
  border-bottom: 1px solid var(--line-strong);
}

.brand {
  gap: 14px;
}

.brand-mark {
  position: static;
  width: 52px;
  height: 52px;
  object-fit: contain;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.brand-copy {
  font-family: var(--font-mono);
  text-transform: uppercase;
}

.brand-copy strong {
  font-size: 13px;
  letter-spacing: 0.04em;
}

.brand-copy small {
  margin-top: 5px;
  font-size: 9px;
  letter-spacing: 0.12em;
}

.topbar-actions {
  gap: 10px;
}

.theme-toggle,
.language-toggle {
  display: inline-flex;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: var(--surface);
}

.theme-toggle button,
.language-toggle button {
  min-width: 44px;
  padding: 8px 10px;
  color: var(--muted);
  border: 0;
  border-right: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  font: 700 9px/1 var(--font-mono);
  letter-spacing: 0.08em;
}

.theme-toggle button:last-child,
.language-toggle button:last-child {
  border-right: 0;
}

.theme-toggle button[aria-pressed="true"],
.language-toggle button[aria-pressed="true"] {
  color: #001408;
  background: var(--lime);
  box-shadow: none;
}

.session-state {
  padding-left: 8px;
}

.connection {
  font: 700 10px/1.2 var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.connection-dot {
  width: 7px;
  height: 7px;
  border-radius: 0;
  background: var(--amber);
  box-shadow: none;
}

.connection[data-connection="connected"] .connection-dot {
  background: var(--lime);
  box-shadow: none;
}

.connection[data-connection="offline"] .connection-dot {
  background: var(--red);
  box-shadow: none;
}

.connection[data-connection="degraded"] .connection-dot {
  background: var(--red);
  box-shadow: none;
}

.session-alias {
  border-radius: 0;
}

main {
  padding: 74px 0 32px;
}

.hero {
  grid-template-columns: minmax(0, 1.36fr) minmax(270px, 0.64fr);
  grid-template-areas:
    "copy guardian"
    "mode mode";
  gap: 44px clamp(40px, 7vw, 120px);
  align-items: center;
  min-height: 650px;
  padding: 42px 0 48px;
  border-bottom: 1px solid var(--line-strong);
}

.hero-copy-block {
  grid-area: copy;
}

.eyebrow {
  margin-bottom: 17px;
  color: var(--lime-deep);
  font: 800 10px/1.2 var(--font-mono);
  letter-spacing: 0.19em;
  text-transform: uppercase;
}

h1 {
  max-width: 900px;
  font-family: var(--font-mono);
  font-size: clamp(48px, 7vw, 106px);
  font-weight: 800;
  line-height: 0.91;
  letter-spacing: -0.075em;
  text-transform: uppercase;
}

h1 span {
  display: block;
}

h1 .hero-accent {
  width: fit-content;
  margin-top: 11px;
  padding: 0.05em 0.1em 0.12em;
  color: #001408;
  background: var(--lime);
}

.hero-copy {
  max-width: 610px;
  margin-top: 30px;
  color: var(--muted);
  font: 500 14px/1.7 var(--font-mono);
}

.guardian-figure {
  grid-area: guardian;
  position: relative;
  align-self: stretch;
  min-height: 390px;
  display: grid;
  place-items: end center;
  margin: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--line-strong);
}

.guardian-tag {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 0;
  padding: 8px 10px;
  color: #001408;
  background: var(--lime);
  font: 800 10px/1 var(--font-mono);
  letter-spacing: 0.1em;
}

.guardian-art {
  width: min(100%, 430px);
  height: auto;
  object-fit: contain;
  object-position: center bottom;
  filter: saturate(1.08) contrast(1.05);
}

:root[data-theme="dark"] .guardian-art,
:root[data-theme="dark"] .brand-mark {
  filter: saturate(1.12) brightness(1.08);
}

.mode-panel {
  grid-area: mode;
  display: grid;
  grid-template-columns: minmax(190px, 0.7fr) minmax(330px, 1.3fr) minmax(260px, 1fr);
  gap: 24px;
  align-items: center;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: var(--surface);
  box-shadow: none;
  backdrop-filter: none;
}

.mode-heading {
  align-items: flex-start;
  flex-direction: column;
  justify-content: center;
  min-height: 104px;
  gap: 9px;
  padding: 20px 24px;
  border-right: 1px solid var(--line);
  font: 700 9px/1.3 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mode-heading strong {
  color: var(--lime-deep);
  font: 800 25px/1 var(--font-mono);
  text-transform: uppercase;
}

.mode-track {
  gap: 0;
  margin: 0;
  border: 1px solid var(--line);
}

.mode-chip {
  gap: 5px;
  min-height: 66px;
  padding: 12px 8px;
  border: 0;
  border-right: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  font: 700 10px/1.2 var(--font-mono);
  text-transform: uppercase;
}

.mode-chip:last-child {
  border-right: 0;
}

.mode-chip[aria-current="true"] {
  color: #001408;
  border-color: var(--line);
  background: var(--lime);
}

.mode-description {
  min-height: 0;
  margin: 0;
  padding: 20px 24px 20px 0;
  font: 500 11px/1.6 var(--font-mono);
}

.metrics {
  gap: 0;
  margin: 34px 0;
  border: 1px solid var(--line-strong);
}

.metric-card {
  min-height: 156px;
  padding: 22px 24px;
  border: 0;
  border-right: 1px solid var(--line);
  border-radius: 0;
  background: var(--surface);
  box-shadow: none;
}

.metric-card:last-child {
  border-right: 0;
}

.metric-card::after {
  top: 22px;
  right: 22px;
  width: 7px;
  height: 7px;
  border-radius: 0;
  background: var(--line-strong);
}

.accent-card {
  color: #001408;
  background: var(--lime);
}

.accent-card .metric-label,
.accent-card .metric-unit {
  color: rgba(0, 20, 8, 0.72);
}

.accent-card::after {
  background: #001408;
}

.metric-label,
.metric-unit {
  font: 700 9px/1.3 var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.metric-value {
  margin: 19px 0 7px;
  font-family: var(--font-mono);
  font-size: clamp(34px, 4vw, 52px);
  font-weight: 800;
}

.content-grid {
  grid-template-columns: minmax(0, 1.34fr) minmax(350px, 0.66fr);
  gap: 24px;
}

.panel {
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: var(--surface);
  box-shadow: none;
  backdrop-filter: none;
}

.timeline-panel {
  min-height: 704px;
  padding: 30px 32px;
}

.panel-heading {
  padding-bottom: 24px;
  border-bottom: 1px solid var(--line);
}

.panel-heading h2,
.warning-card h2,
.privacy-note h2 {
  font-family: var(--font-mono);
  font-size: 22px;
  line-height: 1.16;
  letter-spacing: -0.035em;
}

.live-pill {
  padding: 6px 8px;
  color: #001408;
  border: 0;
  border-radius: 0;
  background: var(--lime);
  font: 800 9px/1 var(--font-mono);
  letter-spacing: 0.08em;
}

.live-pill span {
  width: 5px;
  height: 5px;
  border-radius: 0;
  background: currentColor;
}

.timeline {
  max-height: 600px;
  margin-top: 0;
  padding: 0;
}

.timeline-empty {
  min-height: 540px;
  border-bottom: 1px solid var(--line);
}

.timeline-empty strong {
  margin-top: 0;
  font-family: var(--font-mono);
  font-size: 14px;
}

.timeline-empty span:last-child {
  max-width: 420px;
  margin-top: 10px;
  font: 500 11px/1.6 var(--font-mono);
}

.empty-orbit {
  display: none;
}

.timeline-item {
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 16px;
  padding: 17px 0;
}

.timeline-item::before {
  display: none;
}

.event-mark {
  width: 42px;
  height: 30px;
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: transparent;
  font: 800 9px/1 var(--font-mono);
}

.timeline-item[data-kind="incident"] .event-mark,
.timeline-item[data-kind="decision"] .event-mark {
  color: #001408;
  border-color: var(--lime);
  background: var(--lime);
}

.timeline-item[data-kind="progress"] .event-mark {
  color: #001408;
  border-color: var(--lime);
  background: var(--lime);
}

.event-copy strong {
  font-family: var(--font-mono);
  font-size: 12px;
}

.event-meta,
.event-time {
  font: 500 9px/1.4 var(--font-mono);
}

.side-stack {
  gap: 24px;
}

.warning-card {
  padding: 28px;
}

.warning-card::before {
  inset: 0 0 auto;
  width: auto;
  height: 6px;
  background: var(--lime);
}

.warning-card[data-severity="medium"]::before {
  background: var(--amber);
}

.warning-card[data-severity="high"]::before {
  background: var(--red);
}

.warning-topline {
  padding-top: 10px;
}

.attribution-badge,
.occurrence-badge {
  border-radius: 0;
  background: transparent;
  font: 700 9px/1.2 var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.signal-index {
  width: fit-content;
  margin: 27px 0 22px;
  padding: 7px 9px;
  color: #001408;
  background: var(--lime);
  font: 800 9px/1 var(--font-mono);
  letter-spacing: 0.1em;
}

.warning-card[data-severity="medium"] .signal-index {
  background: var(--amber);
}

.warning-card[data-severity="high"] .signal-index {
  color: #fff;
  background: var(--red);
}

.warning-card > p:not(.eyebrow) {
  font: 500 12px/1.65 var(--font-mono);
}

.warning-action {
  margin-top: 20px;
  padding: 14px 15px;
  border-radius: 0;
  background: var(--surface-soft);
  font: 700 11px/1.55 var(--font-mono);
}

.coach-card {
  padding: 28px;
}

.compact-heading {
  padding-bottom: 20px;
}

.copy-button {
  padding: 8px 10px;
  border-radius: 0;
  color: #001408;
  border-color: var(--lime);
  background: var(--lime);
  font: 800 9px/1 var(--font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.copy-button:hover {
  background: var(--ink);
  color: var(--bg);
}

.coach-status {
  margin-top: 18px;
  font: 500 11px/1.6 var(--font-mono);
}

.prompt-contract {
  gap: 0;
  margin: 18px 0;
  border: 1px solid var(--line);
}

.prompt-contract > div {
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 13px;
  padding: 11px 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
}

.prompt-contract > div:last-child {
  border-bottom: 0;
}

.prompt-contract > div.needs-attention {
  border-color: var(--line);
  background: rgba(255, 193, 107, 0.16);
}

.prompt-contract dt,
.prompt-contract dd {
  font-family: var(--font-mono);
}

.prompt-template {
  padding: 15px;
  border-radius: 0;
  background: var(--surface-soft);
  font: 500 10px/1.72 var(--font-mono);
}

.privacy-note {
  grid-template-columns: minmax(140px, auto) minmax(0, 1fr) auto;
  gap: 24px;
  margin-top: 24px;
  padding: 24px 28px;
  border-color: var(--line-strong);
  border-radius: 0;
  background: var(--surface);
}

.privacy-kicker,
.local-only {
  color: #001408;
  background: var(--lime);
  padding: 8px 10px;
  font: 800 9px/1 var(--font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.privacy-note p {
  font: 500 10px/1.6 var(--font-mono);
}

footer {
  min-height: 92px;
  font: 500 9px/1.4 var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

@media (max-width: 1100px) {
  .app-shell {
    width: min(100% - 40px, 980px);
  }

  .hero {
    grid-template-columns: minmax(0, 1.15fr) minmax(230px, 0.65fr);
    min-height: 590px;
  }

  .mode-panel {
    grid-template-columns: 0.7fr 1.2fr;
  }

  .mode-description {
    grid-column: 1 / -1;
    padding: 0 24px 20px;
  }

  .content-grid {
    grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.92fr);
  }
}

@media (max-width: 860px) {
  .topbar {
    align-items: flex-start;
    padding: 18px 0;
  }

  .topbar-actions {
    flex-wrap: wrap;
  }

  .hero {
    grid-template-columns: minmax(0, 1fr) minmax(210px, 0.55fr);
    gap: 34px 24px;
    min-height: auto;
  }

  .mode-panel {
    width: 100%;
    max-width: none;
  }

  .guardian-figure {
    min-height: 320px;
  }

  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .metric-card:nth-child(2) {
    border-right: 0;
  }

  .metric-card:nth-child(-n + 2) {
    border-bottom: 1px solid var(--line);
  }

  .content-grid {
    grid-template-columns: 1fr;
  }

  .side-stack {
    grid-template-columns: 1fr;
  }

  .timeline-panel {
    min-height: 590px;
  }

  .timeline-empty {
    min-height: 420px;
  }
}

@media (max-width: 680px) {
  .app-shell {
    width: min(100% - 28px, 620px);
  }

  .topbar {
    display: grid;
    gap: 15px;
  }

  .topbar-actions {
    justify-content: flex-start;
  }

  .session-state {
    width: 100%;
    padding-left: 0;
    justify-content: flex-start;
  }

  main {
    padding-top: 34px;
  }

  .hero {
    grid-template-columns: 1fr;
    grid-template-areas:
      "copy"
      "guardian"
      "mode";
    gap: 34px;
    padding: 20px 0 34px;
  }

  h1 {
    font-size: clamp(43px, 15vw, 74px);
  }

  .guardian-figure {
    width: min(100%, 390px);
    min-height: 340px;
    justify-self: center;
  }

  .mode-panel {
    grid-template-columns: 1fr;
  }

  .mode-heading {
    min-height: 0;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .mode-track {
    margin: 0 20px;
  }

  .mode-description {
    grid-column: auto;
    padding: 0 20px 20px;
  }

  .metrics {
    grid-template-columns: 1fr;
  }

  .metric-card,
  .metric-card:nth-child(2) {
    min-height: 132px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .metric-card:last-child {
    border-bottom: 0;
  }

  .timeline-panel,
  .warning-card,
  .coach-card {
    padding: 22px 20px;
  }

  .timeline-panel {
    min-height: 520px;
  }

  .timeline-empty {
    min-height: 360px;
  }

  .privacy-note {
    grid-template-columns: 1fr;
  }

  .local-only {
    width: fit-content;
  }

  footer {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
  }
}

@media (max-width: 430px) {
  .brand-copy small {
    display: none;
  }

  .theme-toggle button,
  .language-toggle button {
    min-width: 38px;
    padding-inline: 7px;
  }

  .guardian-figure {
    min-height: 295px;
  }

  .panel-heading {
    flex-direction: column;
  }

  .compact-heading {
    align-items: flex-start;
  }

  .timeline-item {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .event-time {
    grid-column: 2;
  }

  .prompt-contract > div {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}

.view-toggle {
  min-width: 82px;
  padding: 8px 10px;
  color: var(--muted);
  border: 1px solid var(--line-strong);
  border-radius: 0;
  background: var(--surface);
  box-shadow: none;
  cursor: pointer;
  font: 700 9px/1 var(--font-mono);
  letter-spacing: 0.08em;
}

.view-toggle:hover {
  color: var(--ink);
  border-color: var(--ink);
}

.compact-sentinel {
  display: none;
}

:root[data-view="compact"] {
  min-height: 100%;
  background: transparent;
}

:root[data-view="compact"] body {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  margin: 0;
  overflow: hidden;
  background: transparent;
  background-image: none;
}

:root[data-view="compact"] .skip-link,
:root[data-view="compact"] .app-shell {
  display: none;
}

:root[data-view="compact"] .compact-sentinel {
  position: relative;
  display: grid;
  width: min(90vw, 90vh, 270px);
  width: min(90vw, 90dvh, 270px);
  aspect-ratio: 1;
  place-items: center;
  padding: 0;
  overflow: visible;
  --signal-color: var(--lime);
  color: var(--signal-color);
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  appearance: none;
}

.compact-sentinel img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.compact-sentinel #sentinel-status {
  position: absolute;
  right: 7%;
  bottom: 6%;
  padding: 6px 8px;
  color: #001408;
  background: var(--signal-color);
  border: 1px solid var(--signal-color);
  font: 900 9px/1 var(--font-mono);
  letter-spacing: 0.12em;
}

.compact-sentinel[data-signal="warn"] {
  --signal-color: #ffd43b;
}

.compact-sentinel[data-signal="danger"],
.compact-sentinel[data-signal="critical"] {
  --signal-color: #ff334f;
}

:root[data-view="compact"][data-signal="critical"] body {
  background: #7a0714;
  animation: critical-alert 1.25s ease-in-out infinite alternate;
}

:root[data-view="compact"][data-signal="critical"] .compact-sentinel {
  width: min(94vw, 94vh, 300px);
  width: min(94vw, 94dvh, 300px);
  padding: 10px;
  background: #7a0714;
}

:root[data-view="compact"][data-signal="critical"] .compact-sentinel #sentinel-status {
  color: #7a0714;
  background: #fff0d8;
  border-color: #fff0d8;
}

:root[data-view="compact"] .compact-sentinel:focus-visible {
  outline: 3px solid currentColor;
  outline-offset: 6px;
}

@keyframes critical-alert {
  from {
    background-color: #7a0714;
  }

  to {
    background-color: #b7152a;
  }
}

@media (max-width: 480px), (max-height: 480px) {
  .view-toggle {
    min-width: 70px;
    padding-inline: 7px;
  }

  .compact-sentinel #sentinel-status {
    padding: 5px 6px;
    font-size: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  :root[data-view="compact"][data-signal="critical"] body {
    animation: none;
  }
}
`;

export const DASHBOARD_JS = String.raw`(() => {
  "use strict";

  const RULES = Object.freeze({
    prompt_contract: true,
    retry_after_same_failure: true,
    status_polling_loop: true,
    unchanged_reread: true,
    exact_tool_repeat: true,
    repeated_failure_result: true,
    edit_revert_oscillation: true
  });

  const ISSUES = Object.freeze({
    broad: Object.freeze({ contract: "target" }),
    target: Object.freeze({ contract: "target" }),
    success: Object.freeze({ contract: "success" }),
    verify: Object.freeze({ contract: "verify" }),
    stop: Object.freeze({ contract: "stop" }),
    conflict: Object.freeze({ contract: "conflict" })
  });

  const MODES = Object.freeze({
    observe: true,
    warn: true,
    block: true
  });

  const THEMES = Object.freeze({
    light: true,
    dark: true
  });

  const VIEWS = Object.freeze({
    expanded: true,
    compact: true
  });

  const CONNECTIONS = Object.freeze({
    connecting: true,
    connected: true,
    reconnecting: true,
    degraded: true,
    offline: true
  });

  const TRACE_HEALTH = Object.freeze({
    healthy: true,
    degraded: true
  });

  const ATTRIBUTIONS = Object.freeze({
    user_instruction: true,
    agent: true,
    environment: true,
    harness: true
  });

  const FAMILIES = Object.freeze({
    prompt: true,
    read: true,
    search: true,
    write: true,
    shell: true,
    wait: true,
    subagent: true,
    other: true,
    system: true
  });

  const OPERATIONS = Object.freeze({
    prompt: true,
    read: true,
    search: true,
    write: true,
    test: true,
    build: true,
    verify: true,
    release: true,
    deploy: true,
    sign: true,
    submit: true,
    migrate: true,
    inspect: true,
    wait: true,
    command: true,
    subagent: true,
    other: true,
    progress: true
  });

  const OUTCOMES = Object.freeze({
    started: true,
    succeeded: true,
    failed: true,
    interrupted: true,
    blocked: true,
    warned: true,
    observed: true,
    allowed: true,
    progressed: true
  });

  const COPY = Object.freeze({
    en: Object.freeze({
      title: "AWF — Agent Waste Firewall — Live guidance",
      static: Object.freeze({
        skipLink: "Skip to main content",
        brandLabel: "AWF — Agent Waste Firewall dashboard",
        brandSubtitle: "Agent Waste Firewall / Local live guidance",
        languageLabel: "Language",
        themeLabel: "Color theme",
        themeLight: "LIGHT",
        themeDark: "DARK",
        connectionAria: "Monitor connection status",
        heroEyebrow: "LIVE AGENT SIDECAR",
        heroTitleOne: "WATCH THE WORK.",
        heroTitleTwo: "STOP THE LOOP.",
        heroTag: "LIVE / GUARDIAN 01",
        heroCopy: "Observe semantic signals from Codex and Claude Code without retaining raw content.",
        modeTitle: "Current protection mode",
        modeAria: "Protection mode levels",
        modeObserve: "Observe",
        modeWarn: "Warn",
        modeBlock: "Block",
        metricsAria: "Session summary",
        metricEvents: "Observed events",
        unitEvents: "events",
        metricIncidents: "Detected signals",
        unitIncidents: "incidents",
        metricAvoidable: "Potentially avoidable calls",
        unitCalls: "calls",
        metricElapsed: "Observed time",
        unitElapsed: "elapsed",
        streamEyebrow: "SEMANTIC STREAM",
        timelineTitle: "Live workstream",
        liveLabel: "LIVE",
        timelineEmptyTitle: "Waiting for the first semantic event",
        timelineEmptyCopy: "Raw commands and outputs never reach this screen.",
        guidanceAria: "Current guidance",
        signalEyebrow: "CURRENT SIGNAL",
        coachEyebrow: "PROMPT COACH",
        coachTitle: "A request structure that reduces waste",
        contractTargetTitle: "Task & scope",
        contractTargetCopy: "What to change and what must remain untouched",
        contractSuccessTitle: "Definition of done",
        contractSuccessCopy: "An observable result that proves completion",
        contractVerifyTitle: "Verification",
        contractVerifyCopy: "A test, build, or manual check",
        contractStopTitle: "Stop condition",
        contractStopCopy: "Retry limit and when to report the blocker",
        contractConflictTitle: "Authority & questions",
        contractConflictCopy: "Choices that need approval and forbidden actions",
        privacyTitle: "On this device, without raw content",
        privacyCopy: "Prompts, commands, outputs, source code, and absolute paths are never received or displayed. This view uses only approved semantic categories, numbers, and session aliases.",
        privacyKicker: "LOCAL / RAW-FREE",
        localOnly: "LOCAL ONLY",
        footerCopy: "Data moves only between this browser and the local process."
      }),
      rules: Object.freeze({
        prompt_contract: Object.freeze({
          title: "The request contract needs more detail",
          explanation: "One or more required details are missing: scope, definition of done, verification, or a stop condition.",
          recommendation: "Complete the highlighted items in the request structure before continuing."
        }),
        retry_after_same_failure: Object.freeze({
          title: "Retries continue after the same failure",
          explanation: "The same failing call is starting again without an observable state change.",
          recommendation: "Stop retrying and change the suspected cause or approach first."
        }),
        status_polling_loop: Object.freeze({
          title: "Status checks are repeating too often",
          explanation: "Wait or status checks for the same target continue without a new progress signal.",
          recommendation: "Increase the interval and wait for new output or a completion signal."
        }),
        unchanged_reread: Object.freeze({
          title: "The same content is being read again",
          explanation: "The same read or search scope was inspected again without repository progress.",
          recommendation: "Use the result already obtained or narrow the next read."
        }),
        exact_tool_repeat: Object.freeze({
          title: "The same tool call is repeating",
          explanation: "An equivalent call repeated even though the progress state did not change.",
          recommendation: "Reuse the previous result or switch to a different approach."
        }),
        repeated_failure_result: Object.freeze({
          title: "The same failure result is accumulating",
          explanation: "An identical failure fingerprint was observed consecutively.",
          recommendation: "Isolate the cause and stop running the same command."
        }),
        edit_revert_oscillation: Object.freeze({
          title: "Edits and reverts are oscillating",
          explanation: "A file alias returned to an earlier state after an edit.",
          recommendation: "Confirm the intended final state and edit in one direction."
        })
      }),
      issues: Object.freeze({
        broad: "Scope is too broad",
        target: "Target is unclear",
        success: "Definition of done is missing",
        verify: "Verification method is missing",
        stop: "Stop condition is missing",
        conflict: "Instructions conflict"
      }),
      modes: Object.freeze({
        observe: Object.freeze({
          label: "Observe",
          description: "Record signals without intervening in the agent's work."
        }),
        warn: Object.freeze({
          label: "Warn",
          description: "Explain the cause and next action as soon as a waste signal appears."
        }),
        block: Object.freeze({
          label: "Block",
          description: "Stop high-confidence no-progress repeats before execution."
        })
      }),
      connections: Object.freeze({
        connecting: "Connecting",
        connected: "Connected locally",
        reconnecting: "Reconnecting",
        degraded: "Monitoring degraded",
        offline: "Disconnected"
      }),
      attributions: Object.freeze({
        user_instruction: "Request conditions",
        agent: "Agent",
        environment: "Environment",
        harness: "Tool harness"
      }),
      families: Object.freeze({
        prompt: "Request",
        read: "Read",
        search: "Search",
        write: "Edit",
        shell: "Run",
        wait: "Wait",
        subagent: "Subtask",
        other: "Tool",
        system: "System"
      }),
      operations: Object.freeze({
        prompt: "Contract check",
        read: "File inspection",
        search: "Scope search",
        write: "File change",
        test: "Test",
        build: "Build check",
        verify: "Release verification",
        release: "Release preparation",
        deploy: "External deployment",
        sign: "Signed build",
        submit: "Store submission",
        migrate: "Data change",
        inspect: "Status inspection",
        wait: "Status wait",
        command: "Command run",
        subagent: "Subtask",
        other: "Tool call",
        progress: "Progress update"
      }),
      outcomes: Object.freeze({
        started: "Started",
        succeeded: "Succeeded",
        failed: "Failed",
        interrupted: "Interrupted",
        blocked: "Blocked",
        warned: "Warned",
        observed: "Observed",
        allowed: "Allowed",
        progressed: "Progressed"
      }),
      signals: Object.freeze({
        clear: Object.freeze({
          label: "CLEAR",
          title: "[CLEAR] AWF — Agent Waste Firewall",
          announcement: "No current waste signal."
        }),
        warn: Object.freeze({
          label: "REVIEW",
          title: "[REVIEW] AWF — Agent Waste Firewall",
          announcement: "A waste signal needs review."
        }),
        danger: Object.freeze({
          label: "STOP",
          title: "[STOP] AWF — Agent Waste Firewall",
          announcement: "A high-severity waste signal needs attention."
        }),
        critical: Object.freeze({
          label: "CRITICAL",
          title: "[CRITICAL] AWF — Agent Waste Firewall",
          announcement: "A repeated high-severity signal needs immediate attention."
        }),
        connecting: Object.freeze({
          label: "CONNECTING",
          title: "[CONNECTING] AWF — Agent Waste Firewall",
          announcement: "The local monitor is connecting."
        }),
        offline: Object.freeze({
          label: "OFFLINE",
          title: "[OFFLINE] AWF — Agent Waste Firewall",
          announcement: "The local monitor is disconnected."
        }),
        degraded: Object.freeze({
          label: "DEGRADED",
          title: "[DEGRADED] AWF — Agent Waste Firewall",
          announcement: "Live trace validation failed. Showing the last verified state."
        })
      }),
      dynamic: Object.freeze({
        noWarningTitle: "No current warning",
        noWarningExplanation: "No repetition signal is currently blocking progress.",
        noWarningAction: "Continue observing semantic signals until the work changes.",
        signalClear: "STATUS / CLEAR",
        signalMedium: "SIGNAL / REVIEW",
        signalHigh: "SIGNAL / STOP",
        attributionPrefix: "Attribution · ",
        occurrencePrefix: "Same signal × ",
        occurrenceSuffix: "",
        coachDefault: "Fill in all five items to keep the task on course.",
        coachNeedsPrefix: "Items to improve · ",
        coachNeedsSuffix: "",
        promptNeeds: "The request contract needs more detail",
        promptReady: "The request contract is ready",
        progressTitle: "New progress was observed",
        systemTitle: "Local monitor status updated",
        fallbackTitle: "Guard decision updated",
        causePrefix: "Cause · ",
        viewCompact: "COMPACT",
        viewExpand: "EXPAND",
        viewCompactAria: "Switch to compact sentinel",
        viewExpandAria: "Expand full dashboard",
        copy: "Copy",
        copied: "Copied",
        copySuccess: "Request structure copied.",
        copyFallback: "Select and copy",
        copyFailure: "Automatic copy is unavailable, so focus moved to the request structure."
      }),
      promptTemplate: "Task: [what to change]\nScope: [target files/features and explicit exclusions]\nDone when: [observable result]\nVerify with: [test, build, or manual check]\nStop when: report and stop after the same failure repeats twice"
    }),
    ko: Object.freeze({
      title: "AWF — Agent Waste Firewall — 실시간 가이드",
      static: Object.freeze({
        skipLink: "본문으로 건너뛰기",
        brandLabel: "AWF — Agent Waste Firewall 대시보드",
        brandSubtitle: "Agent Waste Firewall / 로컬 실시간 가이드",
        languageLabel: "언어",
        themeLabel: "화면 테마",
        themeLight: "화이트",
        themeDark: "다크",
        connectionAria: "모니터 연결 상태",
        heroEyebrow: "실시간 에이전트 사이드카",
        heroTitleOne: "작업을 감시하고,",
        heroTitleTwo: "반복을 멈춥니다.",
        heroTag: "실시간 / 가디언 01",
        heroCopy: "Codex와 Claude Code의 원문을 보관하지 않고 의미 신호만 관찰합니다.",
        modeTitle: "현재 보호 모드",
        modeAria: "보호 모드 단계",
        modeObserve: "관찰",
        modeWarn: "경고",
        modeBlock: "차단",
        metricsAria: "세션 요약",
        metricEvents: "관찰 이벤트",
        unitEvents: "이벤트",
        metricIncidents: "감지된 신호",
        unitIncidents: "신호",
        metricAvoidable: "절감 후보 호출",
        unitCalls: "호출",
        metricElapsed: "관찰 시간",
        unitElapsed: "경과",
        streamEyebrow: "의미 신호 스트림",
        timelineTitle: "실시간 작업 흐름",
        liveLabel: "실시간",
        timelineEmptyTitle: "첫 의미 이벤트를 기다리고 있어요",
        timelineEmptyCopy: "명령어나 출력 원문은 이 화면으로 오지 않습니다.",
        guidanceAria: "현재 가이드",
        signalEyebrow: "현재 신호",
        coachEyebrow: "요청 코치",
        coachTitle: "낭비를 줄이는 요청 틀",
        contractTargetTitle: "작업·범위",
        contractTargetCopy: "무엇을 바꾸고, 무엇은 건드리지 않을지",
        contractSuccessTitle: "완료 조건",
        contractSuccessCopy: "눈으로 확인할 수 있는 결과",
        contractVerifyTitle: "검증",
        contractVerifyCopy: "테스트·빌드·수동 확인 중 하나",
        contractStopTitle: "중단 조건",
        contractStopCopy: "같은 실패의 허용 횟수와 보고 시점",
        contractConflictTitle: "권한·질문",
        contractConflictCopy: "확인이 필요한 선택과 금지된 행동",
        privacyTitle: "원문 없이, 이 기기 안에서",
        privacyCopy: "프롬프트·명령어·출력·소스 코드·절대 경로는 받거나 표시하지 않습니다. 이 화면은 허용된 의미 분류, 숫자와 세션 별칭만 사용합니다.",
        privacyKicker: "로컬 / 원문 없음",
        localOnly: "로컬 전용",
        footerCopy: "데이터는 브라우저와 로컬 프로세스 사이에서만 이동합니다."
      }),
      rules: Object.freeze({
        prompt_contract: Object.freeze({
          title: "요청 계약이 충분하지 않아요",
          explanation: "범위·완료 기준·검증·중단 조건 중 필요한 항목이 비어 있습니다.",
          recommendation: "아래 요청 틀에서 표시된 항목을 채운 뒤 작업을 이어가세요."
        }),
        retry_after_same_failure: Object.freeze({
          title: "같은 실패 뒤 재시도가 반복돼요",
          explanation: "상태 변화 없이 같은 실패 조건의 호출이 다시 시작됐습니다.",
          recommendation: "재시도를 멈추고 원인이나 접근 방식을 먼저 바꾸세요."
        }),
        status_polling_loop: Object.freeze({
          title: "상태 확인이 너무 자주 반복돼요",
          explanation: "새 진행 신호 없이 같은 대상의 대기·상태 확인이 이어지고 있습니다.",
          recommendation: "확인 간격을 늘리고 새 출력이나 완료 신호가 올 때까지 기다리세요."
        }),
        unchanged_reread: Object.freeze({
          title: "같은 내용을 다시 읽고 있어요",
          explanation: "저장소 변화 없이 같은 읽기·검색 범위를 반복 확인했습니다.",
          recommendation: "이미 얻은 결과를 사용하거나 다음 읽기 범위를 더 좁히세요."
        }),
        exact_tool_repeat: Object.freeze({
          title: "동일한 도구 호출이 반복돼요",
          explanation: "진행 상태가 바뀌지 않았는데 같은 의미의 호출이 되풀이됐습니다.",
          recommendation: "직전 결과를 재사용하거나 다른 접근으로 전환하세요."
        }),
        repeated_failure_result: Object.freeze({
          title: "같은 실패 결과가 누적돼요",
          explanation: "동일한 실패 지문이 연속해서 관찰됐습니다.",
          recommendation: "실패 원인을 분리해 확인하고 같은 명령의 반복 실행은 중단하세요."
        }),
        edit_revert_oscillation: Object.freeze({
          title: "수정과 되돌리기가 반복돼요",
          explanation: "같은 파일 별칭에서 이전 상태로 돌아오는 편집 진동이 감지됐습니다.",
          recommendation: "원하는 최종 상태를 먼저 확정하고 한 방향으로 수정하세요."
        })
      }),
      issues: Object.freeze({
        broad: "범위가 너무 넓음",
        target: "대상이 불명확함",
        success: "완료 기준이 없음",
        verify: "검증 방법이 없음",
        stop: "중단 조건이 없음",
        conflict: "지시가 서로 충돌함"
      }),
      modes: Object.freeze({
        observe: Object.freeze({
          label: "관찰",
          description: "기록만 하며 에이전트의 작업에는 개입하지 않습니다."
        }),
        warn: Object.freeze({
          label: "경고",
          description: "낭비 신호가 보이면 원인과 다음 행동을 즉시 안내합니다."
        }),
        block: Object.freeze({
          label: "차단",
          description: "확신도 높은 무진행 반복은 실행 전에 안전하게 멈춥니다."
        })
      }),
      connections: Object.freeze({
        connecting: "연결 중",
        connected: "로컬 연결됨",
        reconnecting: "다시 연결 중",
        degraded: "모니터링 오류",
        offline: "연결 끊김"
      }),
      attributions: Object.freeze({
        user_instruction: "요청 조건",
        agent: "에이전트",
        environment: "실행 환경",
        harness: "도구 연결부"
      }),
      families: Object.freeze({
        prompt: "요청",
        read: "읽기",
        search: "검색",
        write: "편집",
        shell: "실행",
        wait: "대기",
        subagent: "하위 작업",
        other: "도구",
        system: "시스템"
      }),
      operations: Object.freeze({
        prompt: "계약 점검",
        read: "파일 확인",
        search: "범위 검색",
        write: "파일 변경",
        test: "테스트",
        build: "빌드·검사",
        verify: "출시 검증",
        release: "출시 준비",
        deploy: "외부 배포",
        sign: "서명 빌드",
        submit: "스토어 제출",
        migrate: "데이터 변경",
        inspect: "상태 점검",
        wait: "상태 대기",
        command: "명령 실행",
        subagent: "하위 작업",
        other: "도구 호출",
        progress: "진행 갱신"
      }),
      outcomes: Object.freeze({
        started: "시작",
        succeeded: "성공",
        failed: "실패",
        interrupted: "중단",
        blocked: "차단",
        warned: "경고",
        observed: "관찰",
        allowed: "허용",
        progressed: "진행"
      }),
      signals: Object.freeze({
        clear: Object.freeze({
          label: "정상",
          title: "[정상] AWF — Agent Waste Firewall",
          announcement: "현재 낭비 신호가 없습니다."
        }),
        warn: Object.freeze({
          label: "점검",
          title: "[점검] AWF — Agent Waste Firewall",
          announcement: "점검이 필요한 낭비 신호가 있습니다."
        }),
        danger: Object.freeze({
          label: "중단",
          title: "[중단] AWF — Agent Waste Firewall",
          announcement: "심각도가 높은 낭비 신호를 확인해야 합니다."
        }),
        critical: Object.freeze({
          label: "긴급",
          title: "[긴급] AWF — Agent Waste Firewall",
          announcement: "심각도가 높은 신호가 반복되어 즉시 확인해야 합니다."
        }),
        connecting: Object.freeze({
          label: "연결 중",
          title: "[연결 중] AWF — Agent Waste Firewall",
          announcement: "로컬 모니터를 연결하고 있습니다."
        }),
        offline: Object.freeze({
          label: "연결 끊김",
          title: "[연결 끊김] AWF — Agent Waste Firewall",
          announcement: "로컬 모니터 연결이 끊겼습니다."
        }),
        degraded: Object.freeze({
          label: "검증 오류",
          title: "[검증 오류] AWF — Agent Waste Firewall",
          announcement: "실시간 trace 검증에 실패해 마지막 정상 상태를 표시합니다."
        })
      }),
      dynamic: Object.freeze({
        noWarningTitle: "현재 경고 없음",
        noWarningExplanation: "진행을 막는 반복 신호가 아직 발견되지 않았습니다.",
        noWarningAction: "작업 변화가 생길 때까지 의미 신호를 계속 관찰합니다.",
        signalClear: "상태 / 정상",
        signalMedium: "신호 / 점검",
        signalHigh: "신호 / 중단",
        attributionPrefix: "원인 분류 · ",
        occurrencePrefix: "같은 신호 ",
        occurrenceSuffix: "회",
        coachDefault: "다섯 항목을 채우면 작업 방향이 쉽게 흔들리지 않아요.",
        coachNeedsPrefix: "보완할 항목 ",
        coachNeedsSuffix: "개",
        promptNeeds: "요청 계약에서 보완점을 찾았어요",
        promptReady: "요청 계약이 준비됐어요",
        progressTitle: "새 진행 상태가 확인됐어요",
        systemTitle: "로컬 모니터 상태가 갱신됐어요",
        fallbackTitle: "가드 판단이 갱신됐어요",
        causePrefix: "원인 · ",
        viewCompact: "축소",
        viewExpand: "펼치기",
        viewCompactAria: "감시 표시만 남기고 축소",
        viewExpandAria: "전체 대시보드 펼치기",
        copy: "복사",
        copied: "복사됨",
        copySuccess: "요청 틀을 복사했습니다.",
        copyFallback: "선택해서 복사",
        copyFailure: "자동 복사를 사용할 수 없어 요청 틀에 초점을 옮겼습니다."
      }),
      promptTemplate: "작업: [무엇을 바꿀지]\n범위: [대상 파일·기능 / 제외할 범위]\n완료 조건: [확인 가능한 결과]\n검증: [테스트·빌드·수동 확인]\n중단 조건: 같은 실패가 2회 반복되면 원인을 보고하고 중단"
    })
  });

  const KINDS = Object.freeze({
    prompt: "PR",
    tool: "TL",
    progress: "GO",
    incident: "!",
    decision: "GD",
    system: "SY"
  });

  const SEVERITIES = Object.freeze({
    none: "none",
    low: "low",
    medium: "medium",
    high: "high"
  });

  const INCIDENT_SEVERITIES = Object.freeze({
    low: true,
    medium: true,
    high: true
  });

  const SIGNALS = Object.freeze({
    clear: true,
    warn: true,
    danger: true,
    critical: true
  });

  const SIGNAL_IMAGES = Object.freeze({
    clear: "/assets/sentinel-eye-clear.webp",
    warn: "/assets/sentinel-eye-warn.webp",
    danger: "/assets/sentinel-eye-critical.webp",
    critical: "/assets/sentinel-eye-critical.webp",
    connecting: "/assets/sentinel-eye-warn.webp",
    degraded: "/assets/sentinel-eye-critical.webp",
    offline: "/assets/sentinel-eye-critical.webp"
  });

  const MAX_METRIC = 999999999;
  const MAX_TIMELINE_ITEMS = 80;
  const ALIAS_PATTERN = /^(?:(?:session|turn|prompt|call|signature|path|content|result)_[a-f0-9]{32,64}|trace_[a-f0-9]{24})$/u;

  const byId = (id) => document.getElementById(id);
  const own = (object, key) =>
    typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);

  function enumValue(value, values) {
    return own(values, value) ? value : null;
  }

  function boundedInteger(value, maximum = MAX_METRIC) {
    return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= maximum
      ? Math.floor(value)
      : null;
  }

  function sequenceInteger(value) {
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
      return null;
    }
    return boundedInteger(Number(value), MAX_METRIC);
  }

  function safeAlias(value) {
    return typeof value === "string" && ALIAS_PATTERN.test(value)
      ? value
      : null;
  }

  function safeIssueIds(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(value.filter((item) => enumValue(item, ISSUES)))
    ).slice(0, Object.keys(ISSUES).length);
  }

  function currentCopy() {
    return COPY[state.language] || COPY.en;
  }

  function formatCount(value) {
    return new Intl.NumberFormat(
      state.language === "ko" ? "ko-KR" : "en-US"
    ).format(value);
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(seconds).padStart(2, "0");
    }
    return String(minutes).padStart(2, "0") + ":" +
      String(seconds).padStart(2, "0");
  }

  function formatRelative(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    if (totalSeconds < 60) {
      return state.language === "ko"
        ? "+" + totalSeconds + "초"
        : "+" + totalSeconds + "s";
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return state.language === "ko"
      ? "+" + minutes + "분 " + seconds + "초"
      : "+" + minutes + "m " + seconds + "s";
  }

  const state = {
    language: "en",
    theme: "light",
    view: "expanded",
    signal: "clear",
    connection: "connecting",
    traceHealth: "healthy",
    mode: "observe",
    metrics: {
      events: 0,
      incidents: 0,
      avoidableCalls: 0,
      elapsedMs: 0
    },
    issueIds: [],
    warning: null,
    timelineEntries: [],
    eventCount: 0,
    baselineSequence: 0
  };

  function visualStateForWarning(warning) {
    if (!warning) return "clear";
    if (warning.severity !== "high") return "warn";
    return warning.occurrences >= 3 ? "critical" : "danger";
  }

  function chromeState() {
    if (state.connection === "degraded") return "degraded";
    if (state.connection === "offline") return "offline";
    if (
      state.connection === "connecting" ||
      state.connection === "reconnecting"
    ) {
      return "connecting";
    }
    return state.signal;
  }

  function renderDocumentChrome() {
    const key = chromeState();
    const copy = currentCopy();
    const signalCopy = copy.signals[key] || copy.signals.clear;
    document.title = signalCopy.title;
    const favicon = byId("dashboard-favicon");
    if (favicon) favicon.setAttribute("href", SIGNAL_IMAGES[key]);
  }

  function renderViewControl() {
    const compact = state.view === "compact";
    const copy = currentCopy();
    const toggle = byId("view-toggle");
    const label = byId("view-toggle-label");
    if (toggle) {
      toggle.setAttribute("aria-expanded", compact ? "false" : "true");
      toggle.setAttribute(
        "aria-label",
        compact ? copy.dynamic.viewExpandAria : copy.dynamic.viewCompactAria
      );
    }
    if (label) {
      label.textContent = compact
        ? copy.dynamic.viewExpand
        : copy.dynamic.viewCompact;
    }
  }

  function renderSentinel() {
    state.signal = enumValue(visualStateForWarning(state.warning), SIGNALS) || "clear";
    const key = chromeState();
    const visualSignal =
      key === "offline" || key === "degraded"
        ? "danger"
        : key === "connecting"
          ? "warn"
          : state.signal;
    const copy = currentCopy();
    const signalCopy = copy.signals[key] || copy.signals.clear;
    document.documentElement.dataset.signal = visualSignal;

    const sentinel = byId("compact-sentinel");
    if (sentinel) {
      sentinel.dataset.signal = visualSignal;
      sentinel.setAttribute(
        "aria-label",
        signalCopy.label + " — " + copy.dynamic.viewExpandAria
      );
    }
    const image = byId("sentinel-image");
    if (image) image.setAttribute("src", SIGNAL_IMAGES[key]);
    const label = byId("sentinel-status");
    if (label) label.textContent = signalCopy.label;
    const live = byId("sentinel-live");
    if (live) live.textContent = signalCopy.announcement;
    renderViewControl();
    renderDocumentChrome();
  }

  function setView(value) {
    const view = enumValue(value, VIEWS);
    if (!view) return;
    state.view = view;
    document.documentElement.dataset.view = view;
    renderViewControl();
  }

  function setConnection(value) {
    const connection = enumValue(value, CONNECTIONS) || "offline";
    state.connection = connection;
    const holder = document.querySelector("[data-connection]");
    if (holder) holder.dataset.connection = connection;
    const label = byId("connection-label");
    if (label) label.textContent = currentCopy().connections[connection];
    document.documentElement.dataset.connection = connection;
    renderSentinel();
  }

  function setMode(value) {
    const mode = enumValue(value, MODES);
    if (!mode) return;
    state.mode = mode;
    const label = byId("active-mode-label");
    const description = byId("mode-description");
    const modeCopy = currentCopy().modes[mode];
    if (label) label.textContent = modeCopy.label;
    if (description) description.textContent = modeCopy.description;
    for (const chip of document.querySelectorAll("[data-mode]")) {
      if (chip.dataset.mode === mode) {
        chip.setAttribute("aria-current", "true");
      } else {
        chip.removeAttribute("aria-current");
      }
    }
    document.documentElement.dataset.mode = mode;
  }

  function setTheme(value) {
    const theme = enumValue(value, THEMES);
    if (!theme) return;
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    for (const button of document.querySelectorAll("[data-theme-option]")) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.themeOption === theme ? "true" : "false"
      );
    }
  }

  function setLanguage(value) {
    const language = value === "ko" ? "ko" : "en";
    state.language = language;
    const copy = currentCopy();
    document.documentElement.setAttribute("lang", language);
    document.documentElement.lang = language;

    for (const element of document.querySelectorAll("[data-i18n]")) {
      const key = element.dataset.i18n;
      if (own(copy.static, key)) element.textContent = copy.static[key];
    }
    for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
      const key = element.dataset.i18nAriaLabel;
      if (own(copy.static, key)) {
        element.setAttribute("aria-label", copy.static[key]);
      }
    }
    for (const button of document.querySelectorAll("[data-language]")) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.language === language ? "true" : "false"
      );
    }

    const template = byId("prompt-template");
    if (template) template.textContent = copy.promptTemplate;
    const copyButton = byId("copy-template");
    if (copyButton) copyButton.textContent = copy.dynamic.copy;
    setConnection(state.connection);
    setMode(state.mode);
    renderMetrics();
    renderWarning(state.warning);
    updateCoach(state.issueIds);
    renderTimeline();
  }

  function renderMetrics() {
    const events = byId("metric-events");
    const incidents = byId("metric-incidents");
    const avoidable = byId("metric-avoidable");
    const elapsed = byId("metric-elapsed");
    if (events) events.textContent = formatCount(state.metrics.events);
    if (incidents) incidents.textContent = formatCount(state.metrics.incidents);
    if (avoidable) avoidable.textContent = formatCount(state.metrics.avoidableCalls);
    if (elapsed) elapsed.textContent = formatElapsed(state.metrics.elapsedMs);
  }

  function normalizeMetrics(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      events: boundedInteger(source.events),
      incidents: boundedInteger(source.incidents),
      avoidableCalls: boundedInteger(
        source.avoidableCalls ?? source.avoidable_calls
      ),
      elapsedMs: boundedInteger(source.elapsedMs ?? source.elapsed_ms, 31536000000)
    };
  }

  function applyMetrics(metrics) {
    for (const key of Object.keys(state.metrics)) {
      if (metrics[key] !== null) state.metrics[key] = metrics[key];
    }
    renderMetrics();
  }

  function normalizeWarning(value) {
    if (!value || typeof value !== "object") return null;
    const ruleId = enumValue(value.ruleId ?? value.rule_id, RULES);
    const severity = enumValue(value.severity, INCIDENT_SEVERITIES);
    if (!ruleId || !severity) return null;
    return {
      ruleId,
      severity,
      attribution:
        enumValue(value.attribution ?? value.category, ATTRIBUTIONS) || "agent",
      occurrences: boundedInteger(value.occurrences, 9999) || 1,
      issueIds: safeIssueIds(value.issueIds ?? value.issue_ids)
    };
  }

  function renderWarning(warning) {
    const card = byId("warning-card");
    const heading = byId("warning-heading");
    const explanation = byId("warning-explanation");
    const action = byId("warning-action");
    const attribution = byId("warning-attribution");
    const occurrences = byId("warning-occurrences");
    const signalIndex = byId("signal-index");
    if (!card || !heading || !explanation || !action) return;
    const copy = currentCopy();
    state.warning = warning
      ? {
          ruleId: warning.ruleId,
          severity: warning.severity,
          attribution: warning.attribution,
          occurrences: warning.occurrences,
          issueIds: safeIssueIds(warning.issueIds)
        }
      : null;
    renderSentinel();

    if (!warning) {
      card.dataset.severity = "none";
      heading.textContent = copy.dynamic.noWarningTitle;
      explanation.textContent = copy.dynamic.noWarningExplanation;
      action.textContent = copy.dynamic.noWarningAction;
      if (signalIndex) signalIndex.textContent = copy.dynamic.signalClear;
      if (attribution) {
        attribution.hidden = true;
        attribution.textContent = "";
      }
      if (occurrences) {
        occurrences.hidden = true;
        occurrences.textContent = "";
      }
      return;
    }

    const rule = copy.rules[warning.ruleId];
    card.dataset.severity = warning.severity;
    heading.textContent = rule.title;
    explanation.textContent = rule.explanation;
    action.textContent = rule.recommendation;
    if (signalIndex) {
      signalIndex.textContent =
        warning.severity === "high"
          ? copy.dynamic.signalHigh
          : copy.dynamic.signalMedium;
    }
    if (attribution) {
      attribution.textContent =
        copy.dynamic.attributionPrefix +
        copy.attributions[warning.attribution];
      attribution.hidden = false;
    }
    if (occurrences) {
      occurrences.textContent =
        copy.dynamic.occurrencePrefix +
        warning.occurrences +
        copy.dynamic.occurrenceSuffix;
      occurrences.hidden = warning.occurrences < 2;
    }
    updateCoach(warning.issueIds);
  }

  function updateCoach(issueIds) {
    const safeIds = safeIssueIds(issueIds);
    state.issueIds = safeIds;
    const contractIds = new Set(safeIds.map((id) => ISSUES[id].contract));
    for (const row of document.querySelectorAll("[data-contract]")) {
      const active = contractIds.has(row.dataset.contract);
      row.classList.toggle("needs-attention", active);
      if (active) {
        row.setAttribute("aria-current", "true");
      } else {
        row.removeAttribute("aria-current");
      }
    }
    const status = byId("coach-status");
    if (!status) return;
    const copy = currentCopy();
    if (safeIds.length === 0) {
      status.textContent = copy.dynamic.coachDefault;
      return;
    }
    const labels = safeIds.map((id) => copy.issues[id]);
    status.textContent =
      copy.dynamic.coachNeedsPrefix +
      safeIds.length +
      copy.dynamic.coachNeedsSuffix +
      " · " +
      labels.join(" · ");
  }

  function normalizeStatus(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const source =
      payload.status && typeof payload.status === "object"
        ? payload.status
        : payload;
    const promptCoach =
      source.promptCoach && typeof source.promptCoach === "object"
        ? source.promptCoach
        : source.prompt && typeof source.prompt === "object"
          ? source.prompt
          : {};
    const warningSource =
      source.currentWarning ?? source.current_warning ?? source.warning ?? null;
    const warning = normalizeWarning(warningSource);
    if (warningSource !== null && !warning) return null;
    const rawTraceHealth = source.traceHealth ?? source.trace_health;
    const traceHealth =
      rawTraceHealth === undefined
        ? "healthy"
        : enumValue(rawTraceHealth, TRACE_HEALTH);
    if (!traceHealth) return null;
    return {
      connected:
        typeof source.connected === "boolean" ? source.connected : true,
      traceHealth,
      mode: enumValue(source.mode, MODES),
      alias: safeAlias(
        source.sessionAlias ?? source.session_alias ?? source.traceAlias
      ),
      metrics: normalizeMetrics(source.metrics),
      lastSequence: boundedInteger(
        source.lastSequence ?? source.last_sequence,
        MAX_METRIC
      ),
      warning,
      issueIds: safeIssueIds(promptCoach.issueIds ?? promptCoach.issue_ids)
    };
  }

  function renderStatus(payload) {
    const status = normalizeStatus(payload);
    if (!status) return;
    state.traceHealth = status.traceHealth;
    setConnection(
      !status.connected
        ? "offline"
        : status.traceHealth === "degraded"
          ? "degraded"
          : "connected"
    );
    if (status.mode) setMode(status.mode);
    applyMetrics(status.metrics);
    if (status.lastSequence !== null) {
      state.baselineSequence = Math.max(
        state.baselineSequence,
        status.lastSequence
      );
    }
    renderWarning(status.warning);
    updateCoach(
      status.warning && status.warning.issueIds.length
        ? status.warning.issueIds
        : status.issueIds
    );
    const alias = byId("session-alias");
    if (alias) {
      alias.textContent = status.alias || "";
      alias.hidden = !status.alias;
    }
  }

  function normalizeEvent(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const kind = enumValue(payload.kind, KINDS);
    if (!kind) return null;
    const ruleId = enumValue(payload.ruleId ?? payload.rule_id, RULES);
    if ((kind === "incident" || kind === "decision") && !ruleId) return null;
    const family = enumValue(payload.family, FAMILIES);
    const operation = enumValue(payload.operation, OPERATIONS);
    const outcome = enumValue(payload.outcome, OUTCOMES);
    if (kind === "tool" && (!family || !operation || !outcome)) return null;
    const severity = enumValue(payload.severity, SEVERITIES) || "none";
    if (
      (kind === "incident" || kind === "decision") &&
      !enumValue(severity, INCIDENT_SEVERITIES)
    ) {
      return null;
    }
    const incidentCountDelta =
      payload.incidentCountDelta ?? payload.incident_count_delta;
    if (
      incidentCountDelta !== undefined &&
      incidentCountDelta !== 0 &&
      incidentCountDelta !== 1
    ) {
      return null;
    }
    return {
      kind,
      family,
      operation,
      outcome,
      ruleId,
      severity,
      attribution:
        enumValue(payload.attribution ?? payload.category, ATTRIBUTIONS),
      alias: safeAlias(payload.alias ?? payload.targetAlias ?? payload.target_alias),
      elapsedMs: boundedInteger(payload.elapsedMs ?? payload.elapsed_ms, 31536000000),
      issueIds: safeIssueIds(payload.issueIds ?? payload.issue_ids),
      occurrences: boundedInteger(payload.occurrences, 9999) || 1,
      incidentCountDelta: incidentCountDelta === 1 ? 1 : 0,
      avoidableCallsDelta:
        boundedInteger(
          payload.avoidableCallsDelta ?? payload.avoidable_calls_delta,
          1000
        ) || 0
    };
  }

  function eventTitle(event) {
    const copy = currentCopy();
    if (event.ruleId) return copy.rules[event.ruleId].title;
    if (event.kind === "prompt") {
      return event.issueIds.length
        ? copy.dynamic.promptNeeds
        : copy.dynamic.promptReady;
    }
    if (event.kind === "progress") return copy.dynamic.progressTitle;
    if (event.kind === "system") return copy.dynamic.systemTitle;
    if (event.kind === "tool") {
      return (
        copy.families[event.family] +
        " · " +
        copy.operations[event.operation]
      );
    }
    return copy.dynamic.fallbackTitle;
  }

  function appendMeta(container, text, className) {
    const item = document.createElement("span");
    if (className) item.className = className;
    item.textContent = text;
    container.append(item);
  }

  function createEventItem(event) {
    const languageCopy = currentCopy();
    const item = document.createElement("li");
    item.className = "timeline-item";
    item.dataset.kind = event.kind;

    const mark = document.createElement("span");
    mark.className = "event-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = KINDS[event.kind];

    const eventCopy = document.createElement("div");
    eventCopy.className = "event-copy";
    const title = document.createElement("strong");
    title.textContent = eventTitle(event);
    const meta = document.createElement("div");
    meta.className = "event-meta";

    if (event.outcome) {
      appendMeta(meta, languageCopy.outcomes[event.outcome]);
    }
    if (event.attribution) {
      appendMeta(
        meta,
        languageCopy.dynamic.causePrefix +
          languageCopy.attributions[event.attribution]
      );
    }
    if (event.alias) appendMeta(meta, event.alias, "event-alias");
    if (event.occurrences > 1) {
      appendMeta(
        meta,
        languageCopy.dynamic.occurrencePrefix +
          event.occurrences +
          languageCopy.dynamic.occurrenceSuffix
      );
    }
    eventCopy.append(title, meta);

    const relative = document.createElement("span");
    relative.className = "event-time";
    relative.textContent =
      event.elapsedMs === null ? "LIVE" : formatRelative(event.elapsedMs);

    item.append(mark, eventCopy, relative);
    return item;
  }

  function renderTimeline() {
    const list = byId("timeline-list");
    if (!list || state.timelineEntries.length === 0) return;
    list.textContent = "";
    for (const event of state.timelineEntries) {
      list.append(createEventItem(event));
    }
  }

  function renderEvent(payload, sequence = null) {
    const event = normalizeEvent(payload);
    if (!event) return;
    const list = byId("timeline-list");
    if (!list) return;
    const empty = byId("timeline-empty");
    if (empty) empty.remove();

    const item = createEventItem(event);
    list.prepend(item);
    state.timelineEntries.unshift(event);
    if (state.timelineEntries.length > MAX_TIMELINE_ITEMS) {
      state.timelineEntries.length = MAX_TIMELINE_ITEMS;
    }
    state.eventCount += 1;
    while (list.children.length > MAX_TIMELINE_ITEMS) {
      list.lastElementChild.remove();
    }

    const shouldCount =
      sequence === null || sequence > state.baselineSequence;
    if (shouldCount) {
      state.metrics.events = Math.min(
        MAX_METRIC,
        state.metrics.events + 1
      );
      state.metrics.incidents = Math.min(
        MAX_METRIC,
        state.metrics.incidents + event.incidentCountDelta
      );
      state.metrics.avoidableCalls = Math.min(
        MAX_METRIC,
        state.metrics.avoidableCalls + event.avoidableCallsDelta
      );
    }
    if (sequence !== null) {
      state.baselineSequence = Math.max(state.baselineSequence, sequence);
    }
    if (event.elapsedMs !== null) {
      state.metrics.elapsedMs = Math.max(
        state.metrics.elapsedMs,
        event.elapsedMs
      );
    }
    renderMetrics();

    if (event.ruleId) {
      renderWarning({
        ruleId: event.ruleId,
        severity: event.severity,
        attribution: event.attribution || "agent",
        occurrences: event.occurrences,
        issueIds: event.issueIds
      });
    } else if (event.kind === "progress") {
      renderWarning(null);
    } else if (event.issueIds.length) {
      updateCoach(event.issueIds);
    }
  }

  function localEndpoint(pathname) {
    const search =
      window.location && typeof window.location.search === "string"
        ? window.location.search
        : "";
    const token = /(?:^\?|&)token=([a-f0-9]{48})(?:&|$)/u.exec(search)?.[1];
    return token
      ? pathname + "?token=" + token
      : pathname;
  }

  async function refreshStatus() {
    try {
      const response = await fetch(localEndpoint("/api/status"), {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("status unavailable");
      renderStatus(await response.json());
    } catch {
      if (state.connection !== "reconnecting") setConnection("offline");
    }
  }

  function consumeMessage(message) {
    let payload;
    try {
      payload = JSON.parse(message.data);
    } catch {
      return;
    }
    if (
      payload &&
      typeof payload === "object" &&
      (payload.kind === "status" || payload.status)
    ) {
      renderStatus(payload);
      return;
    }
    const sequence = sequenceInteger(message.lastEventId);
    renderEvent(payload, sequence);
  }

  function connectEvents() {
    if (typeof EventSource !== "function") {
      setConnection("offline");
      return null;
    }
    const stream = new EventSource(localEndpoint("/events"), {
      withCredentials: false
    });
    stream.onopen = () =>
      setConnection(state.traceHealth === "degraded" ? "degraded" : "connected");
    stream.onerror = () => setConnection("reconnecting");
    stream.onmessage = consumeMessage;
    stream.addEventListener("semantic", consumeMessage);
    stream.addEventListener("status", consumeMessage);
    stream.addEventListener("snapshot", consumeMessage);
    return stream;
  }

  function setupLanguageControls() {
    for (const button of document.querySelectorAll("[data-language]")) {
      button.addEventListener("click", () => {
        setLanguage(button.dataset.language);
      });
    }
  }

  function setupThemeControls() {
    for (const button of document.querySelectorAll("[data-theme-option]")) {
      button.addEventListener("click", () => {
        setTheme(button.dataset.themeOption);
      });
    }
  }

  function setupViewControls() {
    const toggle = byId("view-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        setView(state.view === "expanded" ? "compact" : "expanded");
      });
    }
    const sentinel = byId("compact-sentinel");
    if (sentinel) {
      sentinel.addEventListener("click", () => setView("expanded"));
    }
  }

  function setupCopyButton() {
    const button = byId("copy-template");
    const template = byId("prompt-template");
    const feedback = byId("copy-feedback");
    if (!button || !template) return;
    button.addEventListener("click", async () => {
      const copy = currentCopy();
      try {
        await navigator.clipboard.writeText(template.textContent);
        button.textContent = copy.dynamic.copied;
        if (feedback) feedback.textContent = copy.dynamic.copySuccess;
      } catch {
        button.textContent = copy.dynamic.copyFallback;
        template.focus();
        if (feedback) feedback.textContent = copy.dynamic.copyFailure;
      }
      window.setTimeout(() => {
        button.textContent = currentCopy().dynamic.copy;
      }, 1600);
    });
  }

  setupLanguageControls();
  setupThemeControls();
  setupViewControls();
  setupCopyButton();
  setTheme("light");
  setView("expanded");
  setLanguage("en");
  let stream = null;
  let statusTimer = null;
  refreshStatus().finally(() => {
    stream = connectEvents();
    statusTimer = window.setInterval(refreshStatus, 15000);
  });

  window.addEventListener("beforeunload", () => {
    if (statusTimer !== null) window.clearInterval(statusTimer);
    if (stream) stream.close();
  });
})();
`;
