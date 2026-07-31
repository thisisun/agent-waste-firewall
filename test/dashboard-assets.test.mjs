import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import {
  DASHBOARD_CSS,
  DASHBOARD_HTML,
  DASHBOARD_JS,
} from "../src/dashboard-assets.mjs";

test("dashboard exports a complete English-first, local-only document", () => {
  assert.match(DASHBOARD_HTML, /^<!doctype html>/u);
  assert.match(
    DASHBOARD_HTML,
    /<html lang="en" data-theme="light" data-view="expanded" data-signal="clear">/u,
  );
  assert.match(DASHBOARD_HTML, /href="\/dashboard\.css"/u);
  assert.match(DASHBOARD_HTML, /src="\/dashboard\.js"/u);
  assert.match(DASHBOARD_HTML, /src="\/assets\/guardian-mark\.webp"/u);
  assert.match(DASHBOARD_HTML, /id="dashboard-favicon"/u);
  assert.match(DASHBOARD_HTML, /href="\/assets\/sentinel-eye-clear\.webp"/u);
  assert.match(DASHBOARD_HTML, /id="view-toggle"/u);
  assert.match(DASHBOARD_HTML, /aria-controls="main"/u);
  assert.match(DASHBOARD_HTML, /id="compact-sentinel"/u);
  assert.match(DASHBOARD_HTML, /id="sentinel-image"/u);
  assert.match(DASHBOARD_HTML, /data-theme-option="light"/u);
  assert.match(DASHBOARD_HTML, /data-theme-option="dark"/u);
  assert.match(DASHBOARD_HTML, /data-language="ko"/u);
  assert.match(DASHBOARD_HTML, /id="metric-events"/u);
  assert.match(DASHBOARD_HTML, /id="metric-incidents"/u);
  assert.match(DASHBOARD_HTML, /id="metric-avoidable"/u);
  assert.match(DASHBOARD_HTML, /id="metric-elapsed"/u);
  assert.match(DASHBOARD_HTML, /id="activity-chart"/u);
  assert.match(DASHBOARD_HTML, /id="mix-chart"/u);
  assert.match(DASHBOARD_HTML, /id="detail-dialog"/u);
  assert.match(DASHBOARD_HTML, /data-detail-target="signal"/u);
  assert.match(DASHBOARD_HTML, /data-detail-panel="coach"/u);
  assert.match(DASHBOARD_HTML, /id="timeline-list"/u);
  assert.match(DASHBOARD_HTML, /id="warning-card"/u);
  assert.match(DASHBOARD_HTML, /id="prompt-template"/u);
  assert.match(DASHBOARD_HTML, /id="provider-count"/u);
  assert.match(DASHBOARD_HTML, /data-provider-card="codex"/u);
  assert.match(DASHBOARD_HTML, /data-provider-card="claude"/u);
  assert.match(DASHBOARD_HTML, /On this device, without raw content/u);
  assert.match(DASHBOARD_HTML, /LIVE SESSION/u);
  assert.match(DASHBOARD_HTML, /Live session · local and raw-free/u);
  assert.doesNotMatch(
    DASHBOARD_HTML,
    /실시간 세션 · 원문 없이 로컬에서/u,
  );
  assert.doesNotMatch(DASHBOARD_HTML, /ONE SCREEN\./u);
  assert.doesNotMatch(DASHBOARD_HTML, /ZERO BLIND SPOTS\./u);
  assert.match(DASHBOARD_HTML, /UP TO 80 EVENTS/u);
  assert.match(DASHBOARD_HTML, /Content-Security-Policy/u);
  assert.doesNotMatch(DASHBOARD_HTML, /https?:\/\//iu);
  assert.doesNotMatch(DASHBOARD_HTML, /<svg\b|style="/iu);
});

test("dashboard styles are responsive, accessible, and self-contained", () => {
  assert.match(DASHBOARD_CSS, /color-scheme:\s*light dark/u);
  assert.match(DASHBOARD_CSS, /prefers-color-scheme:\s*dark/u);
  assert.match(DASHBOARD_CSS, /prefers-reduced-motion:\s*reduce/u);
  assert.match(DASHBOARD_CSS, /@media \(max-width:\s*680px\)/u);
  assert.match(DASHBOARD_CSS, /data-theme="dark"/u);
  assert.match(DASHBOARD_CSS, /data-view="compact"/u);
  assert.match(DASHBOARD_CSS, /data-signal="critical"/u);
  assert.match(DASHBOARD_CSS, /background:\s*#7a0714/u);
  assert.match(DASHBOARD_CSS, /url\("\/assets\/paper-grid\.webp"\)/u);
  assert.match(DASHBOARD_CSS, /--lime:\s*#00e58b/u);
  assert.match(DASHBOARD_CSS, /:focus-visible/u);
  assert.match(DASHBOARD_CSS, /\.monitor-grid\s*\{/u);
  assert.match(DASHBOARD_CSS, /\.detail-dialog::backdrop/u);
  const activityChartBlock =
    /\.activity-chart\s*\{\s*(?<body>min-height:[^}]*)\}/u.exec(
      DASHBOARD_CSS,
    )?.groups?.body ??
    "";
  const mixChartBlock =
    /\.mix-chart\s*\{\s*(?<body>min-height:[^}]*)\}/u.exec(DASHBOARD_CSS)
      ?.groups?.body ?? "";
  assert.match(activityChartBlock, /max-height:\s*132px/u);
  assert.match(mixChartBlock, /max-height:\s*64px/u);
  assert.doesNotMatch(activityChartBlock, /height:\s*100%/u);
  assert.doesNotMatch(mixChartBlock, /height:\s*100%/u);
  assert.match(
    DASHBOARD_CSS,
    /@media \(max-width:\s*960px\)[\s\S]*?\.trend-panel\s*\{[\s\S]*?min-height:\s*210px/u,
  );
  assert.doesNotMatch(DASHBOARD_CSS, /@import|url\(\s*["']?https?:/iu);
  assert.doesNotMatch(DASHBOARD_CSS, /magenta|pink|#ff00ff/iu);
});

test("dashboard script uses same-origin status and event endpoints safely", () => {
  assert.match(
    DASHBOARD_JS,
    /new EventSource\(localEndpoint\("\/events"\)/u,
  );
  assert.match(
    DASHBOARD_JS,
    /fetch\(localEndpoint\("\/api\/status"\)/u,
  );
  assert.match(
    DASHBOARD_JS,
    /fetch\(localEndpoint\("\/api\/integrations"\)/u,
  );
  assert.match(DASHBOARD_JS, /credentials:\s*"same-origin"/u);
  assert.doesNotMatch(
    DASHBOARD_JS,
    /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/u,
  );
  assert.doesNotMatch(DASHBOARD_JS, /https?:\/\//iu);
  assert.doesNotMatch(
    DASHBOARD_JS,
    /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/u,
  );
  assert.match(DASHBOARD_JS, /MAX_TIMELINE_ITEMS = 80/u);
  assert.match(DASHBOARD_JS, /getContext\("2d"\)/u);

  for (const ruleId of [
    "prompt_contract",
    "retry_after_same_failure",
    "status_polling_loop",
    "unchanged_reread",
    "exact_tool_repeat",
    "repeated_failure_result",
    "edit_revert_oscillation",
  ]) {
    assert.match(DASHBOARD_JS, new RegExp("\\b" + ruleId + "\\b", "u"));
  }

  for (const issueId of [
    "broad",
    "target",
    "success",
    "verify",
    "stop",
    "conflict",
  ]) {
    assert.match(DASHBOARD_JS, new RegExp("\\b" + issueId + "\\b", "u"));
  }
});

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.className = "";
    this.hidden = false;
    this.listeners = new Map();
    this.parent = null;
    this.open = false;
    this.focused = false;
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  prepend(child) {
    child.parent = this;
    this.children.unshift(child);
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  click() {
    return this.listeners.get("click")?.();
  }

  focus() {
    this.focused = true;
  }

  showModal() {
    this.open = true;
    this.setAttribute("open", "");
  }

  close() {
    this.open = false;
    this.removeAttribute("open");
    this.listeners.get("close")?.({ target: this });
  }

  querySelector() {
    return null;
  }
}

class FakeEventSource {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }

  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }

  emit(payload, name = "message", lastEventId = "") {
    const event = { data: JSON.stringify(payload), lastEventId };
    if (name === "message") this.onmessage?.(event);
    else this.listeners.get(name)?.(event);
  }

  close() {}
}

function dashboardHarness(options = {}) {
  FakeEventSource.instances = [];
  const ids = new Map();
  const modeElements = ["observe", "warn", "block"].map((mode) => {
    const element = new FakeElement("span");
    element.dataset.mode = mode;
    return element;
  });
  const contractElements = ["target", "success", "verify", "stop", "conflict"].map(
    (contract) => {
      const element = new FakeElement("div");
      element.dataset.contract = contract;
      return element;
    },
  );
  const connection = new FakeElement("span");
  connection.dataset.connection = "connecting";
  const warningCard = new FakeElement("section");
  warningCard.dataset.detailPanel = "signal";
  const detailPanels = ["activity", "coach", "system"].map((name) => {
    const element = new FakeElement("section");
    element.dataset.detailPanel = name;
    return element;
  });
  detailPanels.push(warningCard);
  const detailTriggers = ["activity", "signal", "coach", "system"].map((name) => {
    const element = new FakeElement("button");
    element.dataset.detailTarget = name;
    return element;
  });
  const languageButtons = ["en", "ko"].map((language) => {
    const element = new FakeElement("button");
    element.dataset.language = language;
    return element;
  });
  const themeButtons = ["light", "dark"].map((theme) => {
    const element = new FakeElement("button");
    element.dataset.themeOption = theme;
    element.dataset.i18n = theme === "light" ? "themeLight" : "themeDark";
    return element;
  });
  const providerCards = ["codex", "claude"].map((provider) => {
    const element = new FakeElement("article");
    element.dataset.providerCard = provider;
    element.dataset.providerState = "unknown";
    return element;
  });
  const staticElements = [
    "brandSubtitle",
    "overviewEyebrow",
    "overviewTitle",
    "overviewSub",
    "privacyTitle",
    "providerEyebrow",
    "providerTitle",
    "providerCodex",
    "providerClaude",
    "providerNote",
    "footerBrand",
  ].map((key) => {
    const element = new FakeElement("span");
    element.dataset.i18n = key;
    return element;
  });
  const ariaElements = ["languageLabel", "themeLabel"].map((key) => {
    const element = new FakeElement("div");
    element.dataset.i18nAriaLabel = key;
    return element;
  });

  for (const id of [
    "connection-label",
    "active-mode-label",
    "mode-description",
    "metric-events",
    "metric-incidents",
    "metric-avoidable",
    "metric-elapsed",
    "timeline-list",
    "timeline-empty",
    "warning-heading",
    "warning-explanation",
    "warning-action",
    "warning-attribution",
    "warning-occurrences",
    "signal-index",
    "coach-status",
    "copy-template",
    "prompt-template",
    "copy-feedback",
    "session-alias",
    "dashboard-favicon",
    "view-toggle",
    "view-toggle-label",
    "compact-sentinel",
    "sentinel-image",
    "sentinel-status",
    "sentinel-live",
    "overview-status-label",
    "overview-status-title",
    "signal-summary-label",
    "signal-summary-title",
    "signal-summary-copy",
    "signal-summary-action",
    "coach-summary-count",
    "coach-summary-status",
    "system-summary-label",
    "system-summary-title",
    "system-summary-copy",
    "provider-count",
    "provider-codex-state",
    "provider-codex-version",
    "provider-claude-state",
    "provider-claude-version",
    "activity-chart",
    "activity-chart-readout",
    "mix-chart",
    "mix-chart-readout",
    "detail-dialog",
    "detail-title",
    "detail-close",
  ]) {
    ids.set(id, new FakeElement());
  }
  ids.set("warning-card", warningCard);
  ids.get("timeline-list").append(ids.get("timeline-empty"));
  ids.get("prompt-template").textContent =
    "작업: [무엇을 바꿀지]\\n범위: [대상과 제외 범위]";

  const document = {
    documentElement: new FakeElement("html"),
    title: "",
    getElementById(id) {
      return ids.get(id) ?? null;
    },
    querySelector(selector) {
      if (selector === "[data-connection]") return connection;
      const provider = /^\[data-provider-card="(codex|claude)"\]$/u.exec(
        selector,
      )?.[1];
      return provider
        ? providerCards.find((element) => element.dataset.providerCard === provider)
        : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-mode]") return modeElements;
      if (selector === "[data-contract]") return contractElements;
      if (selector === "[data-language]") return languageButtons;
      if (selector === "[data-theme-option]") return themeButtons;
      if (selector === "[data-detail-target]") return detailTriggers;
      if (selector === "[data-detail-panel]") return detailPanels;
      if (selector === "[data-i18n]") {
        return [...staticElements, ...themeButtons];
      }
      if (selector === "[data-i18n-aria-label]") return ariaElements;
      return [];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };

  const languageMessages = [];
  const window = {
    ...(options.nativeBridge === false ? {} : { webkit: {
      messageHandlers: {
        awfLanguage: {
          postMessage(message) {
            languageMessages.push(message);
          },
        },
      },
    } }),
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    addEventListener() {},
  };

  const fetchImpl =
    options.fetch ??
    (async (url) => ({
      ok: true,
      async json() {
        if (String(url).startsWith("/api/integrations")) {
          return options.integration ?? {
            v: 1,
            kind: "provider_integration_status",
            providers: [
              {
                provider: "codex",
                state: "active",
                version: { major: 0, minor: 146, patch: 0 },
                activity: "observed",
              },
              {
                provider: "claude",
                state: "not_detected",
                version: null,
                activity: "not_observed",
              },
            ],
          };
        }
        return {
          connected: true,
          mode: "observe",
          metrics: {
            events: 0,
            incidents: 0,
            avoidableCalls: 0,
            elapsedMs: 0,
          },
        };
      },
    }));

  const context = vm.createContext({
    document,
    window,
    EventSource: FakeEventSource,
    fetch: fetchImpl,
    navigator: {
      clipboard: {
        async writeText() {},
      },
    },
    Intl,
    JSON,
    Object,
    Array,
    Set,
    RegExp,
    String,
    Number,
    Math,
    Error,
  });

  vm.runInContext(DASHBOARD_JS, context);
  return {
    ids,
    connection,
    document,
    modeElements,
    languageButtons,
    languageMessages,
    window,
    themeButtons,
    providerCards,
    staticElements,
    ariaElements,
    detailPanels,
    detailTriggers,
    viewToggle: ids.get("view-toggle"),
    compactSentinel: ids.get("compact-sentinel"),
  };
}

test("native language sync does not echo and user changes use a closed bridge message", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));

  harness.window.__awfSetLanguage("ko");
  assert.equal(harness.document.documentElement.attributes.get("lang"), "ko");
  assert.equal(harness.document.documentElement.lang, "ko");
  assert.equal(
    harness.ids.get("provider-codex-state").textContent,
    "활동 관찰됨",
  );
  assert.deepEqual(harness.languageMessages, []);

  harness.languageButtons[0].click();

  assert.equal(harness.document.documentElement.attributes.get("lang"), "en");
  assert.equal(
    JSON.stringify(harness.languageMessages.at(-1)),
    JSON.stringify({ v: 1, language: "en" }),
  );
});

test("language controls remain English-first without a native bridge", async () => {
  const harness = dashboardHarness({ nativeBridge: false });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.document.documentElement.attributes.get("lang"), "en");
  harness.languageButtons[1].click();
  assert.equal(harness.document.documentElement.attributes.get("lang"), "ko");
  assert.deepEqual(harness.languageMessages, []);
});

test("live stream starts immediately but stays visibly waiting for a slow provider probe", async () => {
  const neverSettles = new Promise(() => {});
  const harness = dashboardHarness({
    fetch: async (url) => {
      if (String(url).startsWith("/api/integrations")) {
        return neverSettles;
      }
      return {
        ok: true,
        async json() {
          return {
            connected: true,
            mode: "observe",
            metrics: {
              events: 0,
              incidents: 0,
              avoidableCalls: 0,
              elapsedMs: 0,
            },
          };
        },
      };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.instances[0].url, "/events");
  FakeEventSource.instances[0].onopen();
  assert.equal(harness.document.documentElement.dataset.signal, "warn");
  assert.equal(harness.ids.get("sentinel-status").textContent, "CONNECTING");
});

test("the first semantic event refreshes unobserved provider evidence", async () => {
  let integrationCalls = 0;
  const harness = dashboardHarness({
    fetch: async (url) => ({
      ok: true,
      async json() {
        if (String(url).startsWith("/api/integrations")) {
          integrationCalls += 1;
          const observed = integrationCalls > 1;
          return {
            v: 1,
            kind: "provider_integration_status",
            providers: [
              {
                provider: "codex",
                state: observed ? "active" : "installed_unverified",
                version: { major: 0, minor: 146, patch: 0 },
                activity: observed ? "observed" : "not_observed",
              },
              {
                provider: "claude",
                state: "not_detected",
                version: null,
                activity: "not_observed",
              },
            ],
          };
        }
        return {
          connected: true,
          mode: "observe",
          metrics: {
            events: 0,
            incidents: 0,
            avoidableCalls: 0,
            elapsedMs: 0,
          },
        };
      },
    }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(integrationCalls, 1);

  FakeEventSource.instances[0].emit({
    kind: "tool",
    family: "shell",
    operation: "test",
    outcome: "succeeded",
    ruleId: null,
    severity: "none",
    attribution: null,
    alias: `call_${"1".repeat(32)}`,
    elapsedMs: 1_000,
    issueIds: [],
    occurrences: 1,
    incidentCountDelta: 0,
    avoidableCallsDelta: 0,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(integrationCalls, 2);
  assert.equal(
    harness.ids.get("provider-codex-state").textContent,
    "Activity observed",
  );
});

test("semantic stream drops raw fields and renders only mapped values", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];
  assert.equal(stream.url, "/events");

  const secret = "RAW_SECRET_COMMAND_SHOULD_NEVER_RENDER";
  stream.emit({
    kind: "incident",
    ruleId: "exact_tool_repeat",
    severity: "high",
    attribution: "agent",
    alias: `call_${"0".repeat(32)}`,
    elapsedMs: 4200,
    occurrences: 3,
    incidentCountDelta: 1,
    avoidableCallsDelta: 1,
    prompt: secret,
    command: secret,
    output: secret,
    message: secret,
    recommendation: secret,
  });

  const rendered = Array.from(harness.ids.values())
    .map((element) => element.textContent)
    .join("\\n");
  assert.doesNotMatch(rendered, new RegExp(secret, "u"));
  assert.match(rendered, /The same tool call is repeating/u);
  assert.match(rendered, /Attribution · Agent/u);
  assert.equal(harness.document.documentElement.dataset.signal, "critical");
  assert.equal(harness.compactSentinel.dataset.signal, "critical");
  assert.equal(
    harness.ids.get("sentinel-image").attributes.get("src"),
    "/assets/sentinel-eye-critical.webp",
  );
  assert.equal(
    harness.ids.get("dashboard-favicon").attributes.get("href"),
    "/assets/sentinel-eye-critical.webp",
  );
  assert.equal(harness.document.title, "[CRITICAL] AWF — Agent Waste Firewall");

  const timeline = harness.ids.get("timeline-list").textContent;
  assert.match(timeline, new RegExp(`call_${"0".repeat(32)}`, "u"));
  assert.doesNotMatch(timeline, new RegExp(secret, "u"));

  harness.languageButtons[1].click();
  const renderedKorean = Array.from(harness.ids.values())
    .map((element) => element.textContent)
    .join("\\n");
  assert.match(renderedKorean, /동일한 도구 호출이 반복돼요/u);
  assert.match(renderedKorean, /원인 분류 · 에이전트/u);
  assert.doesNotMatch(renderedKorean, new RegExp(secret, "u"));

  harness.languageButtons[0].click();
  assert.match(
    harness.ids.get("timeline-list").textContent,
    /The same tool call is repeating/u,
  );

  const beforeUnknown = harness.ids.get("timeline-list").children.length;
  stream.emit({
    kind: "incident",
    ruleId: secret,
    alias: secret,
    message: secret,
  });
  assert.equal(
    harness.ids.get("timeline-list").children.length,
    beforeUnknown,
    "unknown semantic identifiers must be discarded",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "critical");
});

test("status renderer accepts enums, numbers, aliases, and issue IDs only", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];
  const secret = "RAW_STATUS_TEXT_MUST_NOT_RENDER";

  stream.emit(
    {
      kind: "status",
      connected: true,
      traceHealth: "healthy",
      mode: "block",
      sessionAlias: `session_${"1".repeat(32)}`,
      metrics: {
        events: 17,
        incidents: 2,
        avoidableCalls: 5,
        elapsedMs: 65000,
      },
      lastSequence: 17,
      currentWarning: {
        ruleId: "prompt_contract",
        severity: "medium",
        attribution: "user_instruction",
        occurrences: 1,
        issueIds: ["target", "verify", secret],
        message: secret,
      },
      rawPrompt: secret,
    },
    "status",
  );

  const rendered = Array.from(harness.ids.values())
    .map((element) => element.textContent)
    .join("\\n");
  assert.doesNotMatch(rendered, new RegExp(secret, "u"));
  assert.equal(harness.ids.get("active-mode-label").textContent, "Block");
  assert.equal(harness.ids.get("metric-events").textContent, "17");
  assert.equal(harness.ids.get("metric-incidents").textContent, "2");
  assert.equal(harness.ids.get("metric-avoidable").textContent, "5");
  assert.equal(harness.ids.get("metric-elapsed").textContent, "01:05");
  assert.equal(
    harness.ids.get("session-alias").textContent,
    `session_${"1".repeat(32)}`,
  );
  assert.match(harness.ids.get("coach-status").textContent, /Items to improve · 2/u);
  assert.equal(harness.document.documentElement.dataset.signal, "warn");
  assert.equal(harness.ids.get("sentinel-status").textContent, "REVIEW");
  assert.equal(
    harness.ids.get("sentinel-image").attributes.get("src"),
    "/assets/sentinel-eye-warn.webp",
  );

  stream.emit(
    {
      kind: "status",
      connected: true,
      traceHealth: "degraded",
      currentWarning: null,
    },
    "status",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "danger");
  assert.equal(harness.ids.get("sentinel-status").textContent, "DEGRADED");
  assert.equal(harness.document.title, "[DEGRADED] AWF — Agent Waste Firewall");

  stream.emit(
    {
      kind: "status",
      connected: true,
      traceHealth: secret,
      currentWarning: null,
    },
    "status",
  );
  assert.equal(
    harness.ids.get("sentinel-status").textContent,
    "DEGRADED",
    "unknown health values must not replace the last audited state",
  );
  stream.emit(
    {
      kind: "status",
      connected: true,
      traceHealth: "healthy",
      currentWarning: {
        ruleId: "prompt_contract",
        severity: "medium",
        attribution: "user_instruction",
        occurrences: 1,
        issueIds: ["target", "verify"],
      },
    },
    "status",
  );

  harness.languageButtons[1].click();
  assert.equal(harness.document.documentElement.lang, "ko");
  assert.equal(harness.document.title, "[점검] AWF — 에이전트 낭비 방화벽");
  assert.equal(harness.ids.get("active-mode-label").textContent, "차단");
  assert.match(harness.ids.get("coach-status").textContent, /보완할 항목 2개/u);
  assert.match(harness.ids.get("warning-heading").textContent, /요청 계약이 충분하지 않아요/u);

  harness.themeButtons[1].click();
  assert.equal(harness.document.documentElement.dataset.theme, "dark");
  assert.equal(harness.themeButtons[1].attributes.get("aria-pressed"), "true");
  assert.equal(harness.themeButtons[0].attributes.get("aria-pressed"), "false");

  harness.themeButtons[0].click();
  assert.equal(harness.document.documentElement.dataset.theme, "light");
});

test("one-screen summaries open localized raw-free detail panels", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];
  const secret = "RAW_DETAIL_TEXT_MUST_NEVER_RENDER";

  stream.emit(
    {
      kind: "status",
      connected: true,
      traceHealth: "healthy",
      mode: "warn",
      metrics: {
        events: 20,
        incidents: 4,
        avoidableCalls: 2,
        elapsedMs: 91000,
      },
      currentWarning: {
        ruleId: "exact_tool_repeat",
        severity: "medium",
        attribution: "agent",
        occurrences: 2,
        issueIds: ["target", "verify"],
        message: secret,
      },
      prompt: secret,
      output: secret,
    },
    "status",
  );

  assert.equal(harness.ids.get("overview-status-label").textContent, "REVIEW");
  assert.match(
    harness.ids.get("signal-summary-title").textContent,
    /same tool call is repeating/iu,
  );
  assert.equal(
    harness.ids.get("activity-chart-readout").textContent,
    "Recent events shown · 0 · session totals 20 observed · 4 signals · 2 avoidable",
  );
  assert.equal(harness.ids.get("coach-summary-count").textContent, "3 / 5");
  assert.equal(
    harness.ids.get("system-summary-title").textContent,
    "1 / 2 providers observed",
  );

  const signalTrigger = harness.detailTriggers.find(
    (element) => element.dataset.detailTarget === "signal",
  );
  signalTrigger.click();
  assert.equal(harness.ids.get("detail-dialog").open, true);
  assert.equal(harness.document.documentElement.dataset.detailOpen, "true");
  assert.equal(harness.ids.get("detail-title").textContent, "Current signal");
  assert.equal(
    harness.detailPanels.find(
      (element) => element.dataset.detailPanel === "signal",
    ).hidden,
    false,
  );
  assert.equal(
    harness.detailPanels.find(
      (element) => element.dataset.detailPanel === "activity",
    ).hidden,
    true,
  );

  harness.languageButtons[1].click();
  assert.equal(harness.ids.get("detail-title").textContent, "현재 신호");
  assert.equal(harness.ids.get("coach-summary-count").textContent, "3 / 5");
  assert.match(
    harness.ids.get("activity-chart-readout").textContent,
    /최근 표시 0개 · 세션 20 관찰 · 4 신호 · 2 절감 후보/u,
  );

  const rendered = Array.from(harness.ids.values())
    .flatMap((element) => [
      element.textContent,
      ...element.attributes.values(),
    ])
    .join("\\n");
  assert.doesNotMatch(rendered, new RegExp(secret, "u"));

  harness.ids.get("detail-close").click();
  assert.equal(harness.ids.get("detail-dialog").open, false);
  assert.equal(harness.document.documentElement.dataset.detailOpen, "false");
  assert.equal(
    signalTrigger.attributes.get("aria-expanded"),
    "false",
  );
  assert.equal(signalTrigger.focused, true);
});

test("language modes keep overview and live-event copy in one language", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];
  const staticText = (key) =>
    harness.staticElements.find((element) => element.dataset.i18n === key)
      ?.textContent;

  stream.emit({ kind: "system" });

  assert.equal(staticText("brandSubtitle"), "Agent Waste Firewall / Local live guidance");
  assert.equal(staticText("overviewEyebrow"), "AGENT WASTE FIREWALL");
  assert.equal(staticText("overviewSub"), "Live session · local and raw-free");
  assert.equal(staticText("footerBrand"), "AWF — Agent Waste Firewall");
  assert.match(harness.ids.get("timeline-list").textContent, /SY/u);
  assert.match(harness.ids.get("timeline-list").textContent, /LIVE/u);
  assert.equal(
    harness.ids.get("provider-codex-state").textContent,
    "Activity observed",
  );

  harness.languageButtons[1].click();

  assert.equal(staticText("brandSubtitle"), "에이전트 낭비 방화벽 / 로컬 실시간 가이드");
  assert.equal(staticText("overviewEyebrow"), "에이전트 낭비 방화벽");
  assert.equal(staticText("overviewSub"), "실시간 세션 · 원문 없이 로컬에서");
  assert.equal(staticText("footerBrand"), "AWF — 에이전트 낭비 방화벽");
  assert.match(harness.ids.get("timeline-list").textContent, /계통/u);
  assert.match(harness.ids.get("timeline-list").textContent, /실시간/u);
  assert.doesNotMatch(harness.ids.get("timeline-list").textContent, /\bLIVE\b|\bSY\b/u);
  assert.equal(
    harness.ids.get("provider-codex-state").textContent,
    "활동 관찰됨",
  );
  assert.equal(harness.document.title, "[정상] AWF — 에이전트 낭비 방화벽");

  harness.languageButtons[0].click();

  assert.equal(staticText("overviewSub"), "Live session · local and raw-free");
  assert.match(harness.ids.get("timeline-list").textContent, /SY/u);
  assert.match(harness.ids.get("timeline-list").textContent, /LIVE/u);
});

test("provider status stays closed, truthful, and localized", async () => {
  const secret = "RAW_PROVIDER_PATH_OR_OUTPUT_MUST_NOT_RENDER";
  const harness = dashboardHarness({
    integration: {
      v: 1,
      kind: "provider_integration_status",
      providers: [
        {
          provider: "codex",
          state: "needs_install",
          version: { major: 0, minor: 146, patch: 0 },
          activity: "not_observed",
        },
        {
          provider: "claude",
          state: "not_detected",
          version: null,
          activity: "not_observed",
        },
      ],
      path: secret,
      output: secret,
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.ids.get("provider-count").textContent, "0 / 2");
  assert.equal(
    harness.ids.get("provider-codex-state").textContent,
    "Checking",
    "an invalid integration payload must not replace the closed initial state",
  );
  assert.doesNotMatch(
    Array.from(harness.ids.values())
      .map((element) => element.textContent)
      .join("\\n"),
    new RegExp(secret, "u"),
  );

  const valid = dashboardHarness({
    integration: {
      v: 1,
      kind: "provider_integration_status",
      providers: [
        {
          provider: "codex",
          state: "needs_install",
          version: { major: 0, minor: 146, patch: 0 },
          activity: "not_observed",
        },
        {
          provider: "claude",
          state: "not_detected",
          version: null,
          activity: "not_observed",
        },
      ],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(valid.ids.get("provider-count").textContent, "0 / 2");
  assert.equal(
    valid.ids.get("provider-codex-state").textContent,
    "Install the AWF plugin",
  );
  assert.equal(
    valid.ids.get("provider-claude-state").textContent,
    "CLI not detected",
  );
  assert.equal(
    valid.ids.get("provider-codex-version").textContent,
    "Version 0.146.0",
  );
  assert.equal(
    valid.ids.get("system-summary-title").textContent,
    "0 / 2 providers observed",
  );
  assert.equal(valid.document.documentElement.dataset.signal, "warn");

  valid.languageButtons[1].click();
  assert.equal(
    valid.ids.get("provider-codex-state").textContent,
    "AWF 플러그인 설치 필요",
  );
  assert.equal(
    valid.ids.get("provider-claude-state").textContent,
    "CLI를 찾지 못함",
  );
  assert.equal(
    valid.ids.get("provider-codex-version").textContent,
    "버전 0.146.0",
  );
  assert.equal(
    valid.ids.get("system-summary-title").textContent,
    "0 / 2개 연결 관찰",
  );
});

test("a real high warning overrides unobserved provider readiness", async () => {
  const harness = dashboardHarness({
    integration: {
      v: 1,
      kind: "provider_integration_status",
      providers: [
        {
          provider: "codex",
          state: "needs_install",
          version: { major: 0, minor: 146, patch: 0 },
          activity: "not_observed",
        },
        {
          provider: "claude",
          state: "not_detected",
          version: null,
          activity: "not_observed",
        },
      ],
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];
  stream.emit(
    {
      kind: "status",
      connected: true,
      currentWarning: {
        ruleId: "exact_tool_repeat",
        severity: "high",
        attribution: "agent",
        occurrences: 3,
      },
    },
    "status",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "critical");
  assert.equal(harness.ids.get("sentinel-status").textContent, "CRITICAL");
});

test("compact sentinel is localized and expands from the status artwork", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.document.documentElement.dataset.view, "expanded");
  assert.equal(harness.ids.get("view-toggle-label").textContent, "COMPACT");
  assert.equal(
    harness.viewToggle.attributes.get("aria-expanded"),
    "true",
  );

  harness.viewToggle.click();
  assert.equal(harness.document.documentElement.dataset.view, "compact");
  assert.equal(harness.ids.get("view-toggle-label").textContent, "EXPAND");
  assert.equal(
    harness.viewToggle.attributes.get("aria-expanded"),
    "false",
  );

  harness.languageButtons[1].click();
  assert.equal(harness.ids.get("view-toggle-label").textContent, "펼치기");
  assert.equal(
    harness.viewToggle.attributes.get("aria-label"),
    "전체 대시보드 펼치기",
  );

  harness.compactSentinel.click();
  assert.equal(harness.document.documentElement.dataset.view, "expanded");
  assert.equal(harness.ids.get("view-toggle-label").textContent, "축소");
  assert.equal(
    harness.viewToggle.attributes.get("aria-expanded"),
    "true",
  );
});

test("compact sentinel derives only allowlisted live signal levels", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];

  assert.equal(harness.document.documentElement.dataset.signal, "clear");
  assert.equal(harness.ids.get("sentinel-status").textContent, "CLEAR");
  assert.equal(harness.document.title, "[CLEAR] AWF — Agent Waste Firewall");

  for (const severity of ["low", "medium"]) {
    stream.emit(
      {
        kind: "status",
        connected: true,
        mode: "warn",
        metrics: {},
        currentWarning: {
          ruleId: "unchanged_reread",
          severity,
          attribution: "agent",
          occurrences: 1,
        },
      },
      "status",
    );
    assert.equal(harness.document.documentElement.dataset.signal, "warn");
    assert.equal(harness.ids.get("sentinel-status").textContent, "REVIEW");
  }

  stream.emit(
    {
      kind: "status",
      connected: true,
      currentWarning: {
        ruleId: "exact_tool_repeat",
        severity: "high",
        attribution: "agent",
        occurrences: 1,
      },
    },
    "status",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "danger");
  assert.equal(harness.ids.get("sentinel-status").textContent, "STOP");

  stream.emit(
    {
      kind: "status",
      connected: true,
      currentWarning: {
        ruleId: "exact_tool_repeat",
        severity: "high",
        attribution: "agent",
        occurrences: 3,
      },
    },
    "status",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "critical");
  assert.equal(harness.ids.get("sentinel-status").textContent, "CRITICAL");

  const secret = "RAW_SIGNAL_OVERRIDE_MUST_NOT_RENDER";
  stream.emit(
    {
      kind: "status",
      connected: true,
      currentWarning: {
        ruleId: "exact_tool_repeat",
        severity: secret,
        visualState: secret,
        occurrences: 999,
      },
    },
    "status",
  );
  assert.equal(
    harness.document.documentElement.dataset.signal,
    "critical",
    "invalid visual input must not replace the last audited signal",
  );
  assert.doesNotMatch(harness.document.title, new RegExp(secret, "u"));
  assert.doesNotMatch(
    harness.ids.get("dashboard-favicon").attributes.get("href"),
    new RegExp(secret, "u"),
  );

  stream.emit({
    kind: "progress",
    elapsedMs: 1500,
  });
  assert.equal(
    harness.document.documentElement.dataset.signal,
    "clear",
    "an audited progress event resolves the active compact warning",
  );

  stream.emit(
    {
      kind: "status",
      connected: true,
      currentWarning: null,
    },
    "status",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "clear");

  stream.emit(
    {
      kind: "status",
      connected: false,
      currentWarning: null,
    },
    "status",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "danger");
  assert.equal(harness.ids.get("sentinel-status").textContent, "OFFLINE");
  assert.equal(harness.document.title, "[OFFLINE] AWF — Agent Waste Firewall");

  harness.languageButtons[1].click();
  assert.equal(harness.ids.get("sentinel-status").textContent, "연결 끊김");
  assert.equal(harness.document.title, "[연결 끊김] AWF — 에이전트 낭비 방화벽");
});

test("historical SSE events render without double-counting status metrics", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];

  stream.emit(
    {
      kind: "status",
      connected: true,
      mode: "observe",
      metrics: {
        events: 2,
        incidents: 1,
        avoidableCalls: 1,
        elapsedMs: 1000,
      },
      lastSequence: 2,
    },
    "status",
  );
  stream.emit(
    {
      kind: "incident",
      ruleId: "exact_tool_repeat",
      severity: "medium",
      attribution: "agent",
      elapsedMs: 500,
      incidentCountDelta: 1,
      avoidableCallsDelta: 1,
    },
    "message",
    "1",
  );
  stream.emit(
    {
      kind: "tool",
      family: "read",
      operation: "inspect",
      outcome: "started",
      elapsedMs: 1000,
    },
    "message",
    "2",
  );

  assert.equal(harness.ids.get("metric-events").textContent, "2");
  assert.equal(harness.ids.get("metric-incidents").textContent, "1");
  assert.equal(harness.ids.get("metric-avoidable").textContent, "1");
  assert.equal(harness.ids.get("timeline-list").children.length, 2);

  stream.emit(
    {
      kind: "tool",
      family: "shell",
      operation: "verify",
      outcome: "succeeded",
      elapsedMs: 1500,
    },
    "message",
    "3",
  );
  assert.equal(harness.ids.get("metric-events").textContent, "3");

  stream.emit(
    {
      kind: "incident",
      ruleId: "exact_tool_repeat",
      severity: "high",
      attribution: "agent",
      occurrences: 3,
      incidentCountDelta: 0,
      avoidableCallsDelta: 0,
      elapsedMs: 1800,
    },
    "message",
    "4",
  );
  assert.equal(harness.ids.get("metric-events").textContent, "4");
  assert.equal(
    harness.ids.get("metric-incidents").textContent,
    "1",
    "deduplicated escalation events must not inflate the incident metric",
  );
  assert.equal(harness.document.documentElement.dataset.signal, "critical");

  const beforeInvalidDelta =
    harness.ids.get("timeline-list").children.length;
  stream.emit(
    {
      kind: "incident",
      ruleId: "exact_tool_repeat",
      severity: "high",
      incidentCountDelta: 2,
    },
    "message",
    "5",
  );
  assert.equal(
    harness.ids.get("timeline-list").children.length,
    beforeInvalidDelta,
    "incident deltas outside the closed 0/1 allowlist must be rejected",
  );
});

test("live snapshots reset projection state and composite IDs deduplicate reconnects", async () => {
  const harness = dashboardHarness();
  await new Promise((resolve) => setImmediate(resolve));
  const stream = FakeEventSource.instances[0];
  const firstAlias = `generation_${"1".repeat(32)}`;
  const secondAlias = `generation_${"2".repeat(32)}`;
  const sessionAlias = `session_${"3".repeat(32)}`;

  stream.emit(
    {
      kind: "status",
      status: {
        v: 1,
        connected: true,
        source: "live",
        sourceState: "active",
        streamHealth: "healthy",
        coverage: "complete",
        generation: 1,
        streamAlias: firstAlias,
        mode: "warn",
        traceAlias: sessionAlias,
        metrics: {
          events: 2,
          incidents: 1,
          avoidableCalls: 1,
          elapsedMs: 2000,
        },
        lastSequence: 2,
        currentWarning: {
          ruleId: "exact_tool_repeat",
          severity: "high",
          attribution: "agent",
          occurrences: 3,
          issueIds: [],
        },
        promptCoach: { issueIds: ["verify"] },
      },
    },
    "status",
  );
  const event = {
    kind: "tool",
    family: "shell",
    operation: "inspect",
    outcome: "started",
    ruleId: null,
    severity: "none",
    attribution: null,
    alias: sessionAlias,
    elapsedMs: 1000,
    issueIds: [],
    occurrences: 1,
    incidentCountDelta: 0,
    avoidableCallsDelta: 0,
  };
  stream.emit(event, "message", `${firstAlias}:1`);
  stream.emit(event, "message", `${firstAlias}:2`);
  stream.emit(event, "message", `${firstAlias}:2`);
  assert.equal(harness.ids.get("timeline-list").children.length, 2);
  assert.equal(harness.document.documentElement.dataset.signal, "critical");

  stream.emit(
    {
      kind: "snapshot",
      reset: true,
      status: {
        v: 1,
        connected: true,
        source: "live",
        sourceState: "active",
        streamHealth: "healthy",
        coverage: "complete",
        generation: 2,
        streamAlias: secondAlias,
        mode: "warn",
        traceAlias: sessionAlias,
        metrics: {
          events: 1,
          incidents: 0,
          avoidableCalls: 0,
          elapsedMs: 3000,
        },
        lastSequence: 1_000_000_001,
        currentWarning: null,
        promptCoach: { issueIds: [] },
      },
    },
    "snapshot",
  );
  assert.equal(harness.ids.get("metric-events").textContent, "1");
  assert.equal(harness.ids.get("metric-incidents").textContent, "0");
  assert.equal(harness.ids.get("timeline-list").children.length, 1);
  assert.equal(harness.document.documentElement.dataset.signal, "clear");
  assert.doesNotMatch(
    harness.ids.get("coach-status").textContent,
    /Items to improve/u,
  );

  stream.emit(
    {
      ...event,
      elapsedMs: 3000,
    },
    "message",
    `${secondAlias}:1000000001`,
  );
  stream.emit(
    {
      ...event,
      elapsedMs: 3000,
    },
    "message",
    `${secondAlias}:1000000001`,
  );
  assert.equal(harness.ids.get("timeline-list").children.length, 1);
  assert.equal(
    harness.ids.get("metric-events").textContent,
    "1",
    "historical replay after reset must not double-count metrics",
  );

  const beforeRejectedFrames =
    harness.ids.get("timeline-list").children.length;
  stream.emit(event, "message", "");
  stream.emit(event, "message", `${firstAlias}:1000000002`);
  assert.equal(
    harness.ids.get("timeline-list").children.length,
    beforeRejectedFrames,
    "missing and prior-generation live IDs must be rejected",
  );

  stream.emit(
    {
      kind: "status",
      status: {
        v: 1,
        connected: true,
        source: "live",
        sourceState: "active",
        streamHealth: "healthy",
        coverage: "complete",
        generation: 1,
        streamAlias: firstAlias,
        mode: "warn",
        metrics: {
          events: 99,
          incidents: 99,
          avoidableCalls: 99,
          elapsedMs: 9999,
        },
        lastSequence: 99,
        currentWarning: {
          ruleId: "exact_tool_repeat",
          severity: "high",
          attribution: "agent",
          occurrences: 3,
          issueIds: [],
        },
        promptCoach: { issueIds: [] },
      },
    },
    "status",
  );
  assert.equal(harness.ids.get("metric-events").textContent, "1");
  assert.equal(
    harness.document.documentElement.dataset.signal,
    "clear",
    "a delayed older generation must not restore an obsolete warning",
  );
});
