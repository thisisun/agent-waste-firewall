import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import {
  DASHBOARD_CSS,
  DASHBOARD_HTML,
  DASHBOARD_JS,
} from "./dashboard-assets.mjs";
import { DashboardLiveCursor } from "./dashboard-live-cursor.mjs";
import {
  projectLiveDashboardEvent,
  projectLiveDashboardStatus,
  projectTraceDashboardEvent,
  projectTraceDashboardStatus,
} from "./dashboard-projection.mjs";
import { validateDashboardStatus } from "./dashboard-status-schema.mjs";
import { DashboardTraceCursor } from "./dashboard-trace-cursor.mjs";
import { LiveEventStore } from "./live-event-store.mjs";
import {
  providerIntegrationStatusAsync,
  validateProviderIntegrationStatus,
} from "./provider-integration-status.mjs";
import { TraceStore } from "./trace-store.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DASHBOARD_TOKEN = /^[0-9a-f]{48}$/u;
const PROVIDER_CACHE_MS = 15_000;
const PROVIDER_ACTIVITY_FRESH_MS = 5 * 60 * 1_000;
const DASHBOARD_ASSET_LOAD_TIMEOUT_MS = 1_000;
const UNKNOWN_PROVIDER_INTEGRATION = validateProviderIntegrationStatus({
  v: 1,
  kind: "provider_integration_status",
  providers: [
    {
      provider: "codex",
      state: "unknown",
      version: null,
      activity: "unknown",
    },
    {
      provider: "claude",
      state: "unknown",
      version: null,
      activity: "unknown",
    },
  ],
});
const DASHBOARD_ASSET_URLS = new Map([
  [
    "/assets/guardian-mark.webp",
    new URL("../assets/guardian-mark.webp", import.meta.url),
  ],
  [
    "/assets/paper-grid.webp",
    new URL("../assets/paper-grid.webp", import.meta.url),
  ],
  [
    "/assets/sentinel-eye-clear.webp",
    new URL("../assets/sentinel-eye-clear.webp", import.meta.url),
  ],
  [
    "/assets/sentinel-eye-warn.webp",
    new URL("../assets/sentinel-eye-warn.webp", import.meta.url),
  ],
  [
    "/assets/sentinel-eye-critical.webp",
    new URL("../assets/sentinel-eye-critical.webp", import.meta.url),
  ],
]);
const DASHBOARD_ASSET_CACHE = new Map();

function dashboardAsset(pathname) {
  if (DASHBOARD_ASSET_CACHE.has(pathname)) {
    return DASHBOARD_ASSET_CACHE.get(pathname);
  }
  const url = DASHBOARD_ASSET_URLS.get(pathname);
  if (!url) return null;
  const pending = fs.promises.readFile(url).then(
    (body) => {
      DASHBOARD_ASSET_CACHE.set(pathname, body);
      return body;
    },
    (error) => {
      DASHBOARD_ASSET_CACHE.delete(pathname);
      throw error;
    },
  );
  DASHBOARD_ASSET_CACHE.set(pathname, pending);
  return pending;
}

function json(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function asset(response, contentType, body) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(body);
}

function safePort(value) {
  const parsed = Number.parseInt(String(value ?? "4319"), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error("Dashboard port must be between 0 and 65535.");
  }
  return parsed;
}

function safeAssetLoadTimeout(value) {
  if (value === undefined) return DASHBOARD_ASSET_LOAD_TIMEOUT_MS;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > DASHBOARD_ASSET_LOAD_TIMEOUT_MS
  ) {
    throw new Error("Dashboard asset timeout must be between 1 and 1000 ms.");
  }
  return parsed;
}

async function readDashboardAsset(load, pathname, timeoutMs) {
  let timeout = null;
  try {
    const unavailable = new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Dashboard asset unavailable.")),
        timeoutMs,
      );
    });
    const body = await Promise.race([
      Promise.resolve().then(() => load(pathname)),
      unavailable,
    ]);
    if (!Buffer.isBuffer(body)) {
      throw new Error("Dashboard asset unavailable.");
    }
    return body;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function safeToken(value) {
  if (value === undefined || value === null) {
    return crypto.randomBytes(24).toString("hex");
  }
  if (typeof value !== "string" || !DASHBOARD_TOKEN.test(value)) {
    throw new Error(
      "Dashboard token must contain exactly 48 lowercase hexadecimal characters.",
    );
  }
  return value;
}

function loopbackAuthority(value, port) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) {
    return false;
  }
  try {
    const parsed = new URL(`http://${value}`);
    const hostname = parsed.hostname.replace(/^\[|\]$/gu, "");
    const parsedPort = Number.parseInt(parsed.port || "80", 10);
    return (
      parsed.protocol === "http:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      LOOPBACK_HOSTS.has(hostname) &&
      parsedPort === port
    );
  } catch {
    return false;
  }
}

function trustedRequestAuthority(request, port) {
  if (!loopbackAuthority(request.headers.host, port)) {
    return false;
  }
  const origin = request.headers.origin;
  if (origin === undefined) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      loopbackAuthority(parsed.host, port)
    );
  } catch {
    return false;
  }
}

function authorized(requestUrl, token) {
  const candidate = requestUrl.searchParams.get("token");
  const expectedDigest = crypto
    .createHash("sha256")
    .update(String(token), "utf8")
    .digest();
  const candidateDigest = crypto
    .createHash("sha256")
    .update(candidate ?? "", "utf8")
    .digest();
  return (
    candidate !== null &&
    crypto.timingSafeEqual(candidateDigest, expectedDigest)
  );
}

function traceStatusPayload(store, traceId, cursor, snapshot = null) {
  const events = snapshot?.events ?? cursor.readEvents();
  return projectTraceDashboardStatus({
    storeStatus: store.status(traceId),
    events,
    health: snapshot?.health ?? cursor.health,
    generation: snapshot?.generation ?? cursor.generation,
  });
}

function liveStatusPayload(cursor, snapshot = null) {
  return projectLiveDashboardStatus(snapshot ?? cursor.readSnapshot());
}

function withProviderActivity(status, activityByProvider) {
  return validateProviderIntegrationStatus({
    v: 1,
    kind: "provider_integration_status",
    providers: status.providers.map((provider) => {
      const activity = activityByProvider[provider.provider] ?? "unknown";
      let state = provider.state;
      if (activity === "observed") {
        state =
          state === "installed_unverified" || state === "active"
            ? "active"
            : "unknown";
      } else if (state === "active") {
        state = "installed_unverified";
      }
      return {
        provider: provider.provider,
        state,
        version: provider.version,
        activity,
      };
    }),
  });
}

function parseResumeCursor(value, source) {
  const text = String(value ?? "");
  if (text === "") {
    return {
      invalid: false,
      sequence: 0,
      streamAlias: null,
    };
  }
  if (source === "live") {
    const match = /^(generation_[0-9a-f]{32}):([1-9][0-9]*)$/u.exec(text);
    const sequence = match ? Number.parseInt(match[2], 10) : Number.NaN;
    return {
      invalid: !match || !Number.isSafeInteger(sequence),
      sequence: Number.isSafeInteger(sequence) ? sequence : 0,
      streamAlias: match?.[1] ?? null,
    };
  }
  const sequence = Number.parseInt(text, 10);
  return {
    invalid:
      !/^(?:0|[1-9][0-9]*)$/u.test(text) ||
      !Number.isSafeInteger(sequence),
    sequence: Number.isSafeInteger(sequence) ? sequence : 0,
    streamAlias: null,
  };
}

function serveEventStream(
  request,
  response,
  cursor,
  {
    activeStreams,
    observeProviderEvents,
    projectEvent,
    snapshotStatus,
    source,
  },
) {
  response.writeHead(200, {
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  });
  response.write("retry: 1000\n\n");
  activeStreams.add(response);

  const resume = parseResumeCursor(
    request.headers["last-event-id"],
    source,
  );
  let lastSequence = resume.sequence;
  let streamIdentity =
    source === "live" ? resume.streamAlias : null;
  let forceReset = resume.invalid;
  let lastStatusText = null;
  let interval = null;
  let heartbeat = null;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (interval) clearInterval(interval);
    if (heartbeat) clearInterval(heartbeat);
    activeStreams.delete(response);
  };

  const sendNewEvents = () => {
    if (response.destroyed || response.writableEnded) {
      cleanup();
      return;
    }
    try {
      const frame =
        typeof cursor.readFrameAfter === "function"
          ? cursor.readFrameAfter(lastSequence)
          : {
              allEvents: null,
              snapshot: null,
              window: cursor.readWindowAfter(lastSequence),
            };
      let window = frame.window;
      const status = snapshotStatus(frame.snapshot);
      const statusText = JSON.stringify({
        kind: "status",
        status,
      });
      const windowIdentity =
        source === "live" ? window.streamAlias : window.generation;
      const reset =
        forceReset ||
        (streamIdentity !== null &&
          windowIdentity !== streamIdentity) ||
        lastSequence > window.lastSequence;
      streamIdentity = windowIdentity;
      if (reset) {
        forceReset = false;
        lastSequence = 0;
        response.write("id:\n");
        response.write("event: snapshot\n");
        response.write(
          `data: ${JSON.stringify({
            kind: "snapshot",
            reset: true,
            status,
          })}\n\n`,
        );
        window =
          frame.allEvents === null
            ? cursor.readWindowAfter(lastSequence)
            : {
                ...window,
                events: frame.allEvents,
              };
        streamIdentity =
          source === "live" ? window.streamAlias : window.generation;
        lastStatusText = statusText;
      } else if (lastStatusText !== statusText) {
        response.write("event: status\n");
        response.write(`data: ${statusText}\n\n`);
        lastStatusText = statusText;
      }
      if (source === "live" && typeof observeProviderEvents === "function") {
        observeProviderEvents(
          window.events,
          window.streamAlias,
          frame.snapshot?.initialized ?? true,
        );
      }
      for (const event of window.events) {
        const eventId =
          source === "live"
            ? `${window.streamAlias}:${event.seq}`
            : String(event.seq);
        response.write(`id: ${eventId}\n`);
        response.write(
          `data: ${JSON.stringify(projectEvent(event))}\n\n`,
        );
        lastSequence = event.seq;
      }
      if (window.events.length > 0) {
        response.write("event: status\n");
        response.write(`data: ${statusText}\n\n`);
        lastStatusText = statusText;
      }
    } catch {
      cleanup();
      response.destroy();
    }
  };

  sendNewEvents();
  if (response.destroyed || response.writableEnded) return;
  interval = setInterval(sendNewEvents, 500);
  heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) {
      response.write(": heartbeat\n\n");
    }
  }, 15_000);
  request.once("aborted", cleanup);
  response.once("close", cleanup);
}

export async function startDashboard(options = {}) {
  const host = String(options.host ?? "127.0.0.1");
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("The dashboard may only bind to a loopback address.");
  }
  const port = safePort(options.port);
  const token = safeToken(options.token);
  const inferredSource =
    options.store instanceof LiveEventStore
      ? "live"
      : options.traceId || options.store
        ? "trace"
        : "live";
  const source = String(options.source ?? inferredSource);
  if (source !== "live" && source !== "trace") {
    throw new Error("Dashboard source must be live or trace.");
  }
  let store;
  let traceId = null;
  let cursor;
  let projectEvent;
  let snapshotStatus;
  if (source === "live") {
    store =
      options.store ??
      new LiveEventStore({
        root: options.root,
        clock: options.clock,
        env: options.env,
      });
    cursor = new DashboardLiveCursor(store, {
      mode: options.mode ?? options.env?.AGENT_WASTE_FIREWALL_MODE,
      clock: options.clock,
    });
    cursor.readEvents();
    projectEvent = projectLiveDashboardEvent;
    snapshotStatus = (snapshot) =>
      validateDashboardStatus(liveStatusPayload(cursor, snapshot));
  } else {
    store =
      options.store ??
      new TraceStore({
        root: options.root,
        clock: options.clock,
        env: options.env,
      });
    const status = store.status(options.traceId ?? null);
    if (!status) {
      throw new Error("No trace is available. Start a recording first.");
    }
    traceId = status.traceId;
    cursor = new DashboardTraceCursor(store, traceId);
    cursor.readEvents();
    projectEvent = projectTraceDashboardEvent;
    snapshotStatus = (snapshot) =>
      validateDashboardStatus(
        traceStatusPayload(store, traceId, cursor, snapshot),
      );
  }
  const integrationNow =
    typeof options.integrationClock === "function"
      ? options.integrationClock
      : () => Date.now();
  const loadDashboardAsset =
    typeof options.dashboardAssetLoader === "function"
      ? options.dashboardAssetLoader
      : dashboardAsset;
  const dashboardAssetLoadTimeoutMs = safeAssetLoadTimeout(
    options.dashboardAssetLoadTimeoutMs,
  );
  const initialProviderEvents =
    source === "live" ? cursor.readEvents() : [];
  const initialProviderSnapshot =
    source === "live" ? cursor.currentSnapshot() : null;
  let providerActivityAlias =
    source === "live" ? cursor.streamAlias : null;
  let providerActivitySequence =
    source === "live"
      ? initialProviderEvents.at(-1)?.seq ?? 0
      : 0;
  let providerBaselineEstablished =
    source !== "live" || initialProviderSnapshot?.initialized === true;
  const providerLastObservedAt = {
    codex: null,
    claude: null,
  };
  const observeProviderEvents = (
    events,
    streamAlias,
    initialized = true,
  ) => {
    if (source !== "live" || !Array.isArray(events)) return;
    const now = Number(integrationNow());
    if (!Number.isFinite(now)) return;
    if (!providerBaselineEstablished) {
      if (!initialized) return;
      providerActivityAlias = streamAlias;
      providerActivitySequence = events.at(-1)?.seq ?? 0;
      providerBaselineEstablished = true;
      return;
    }
    if (streamAlias !== providerActivityAlias) {
      providerActivityAlias = streamAlias;
      providerActivitySequence = 0;
    }
    for (const event of events) {
      if (
        event.seq > providerActivitySequence &&
        (event.platform === "codex" || event.platform === "claude")
      ) {
        providerLastObservedAt[event.platform] = now;
      }
    }
    providerActivitySequence = Math.max(
      providerActivitySequence,
      events.at(-1)?.seq ?? 0,
    );
  };
  const currentProviderActivity = () => {
    if (source !== "live") {
      return { codex: "unknown", claude: "unknown" };
    }
    const now = Number(integrationNow());
    if (!Number.isFinite(now)) {
      return { codex: "unknown", claude: "unknown" };
    }
    return Object.fromEntries(
      ["codex", "claude"].map((provider) => {
        const observedAt = providerLastObservedAt[provider];
        const age = observedAt === null ? null : now - observedAt;
        return [
          provider,
          age !== null &&
          age >= 0 &&
          age <= PROVIDER_ACTIVITY_FRESH_MS
            ? "observed"
            : "not_observed",
        ];
      }),
    );
  };
  let actualPort = port;
  const urlHost = host === "::1" ? "[::1]" : host;
  const activeStreams = new Set();
  const activeSockets = new Set();
  let maintenanceInterval = null;
  let providerCache = null;
  let providerCacheAt = 0;
  let providerProbe = null;
  const providerAbortController = new AbortController();
  const readProviderIntegration = () => {
    if (providerAbortController.signal.aborted) {
      return Promise.resolve(UNKNOWN_PROVIDER_INTEGRATION);
    }
    const now = Number(integrationNow());
    if (
      providerCache &&
      Number.isFinite(now) &&
      now - providerCacheAt >= 0 &&
      now - providerCacheAt < PROVIDER_CACHE_MS
    ) {
      return Promise.resolve(
        withProviderActivity(providerCache, currentProviderActivity()),
      );
    }
    if (providerProbe) {
      return providerProbe.then((status) =>
        withProviderActivity(status, currentProviderActivity())
      );
    }
    providerProbe = providerIntegrationStatusAsync({
      env: options.env ?? process.env,
      runner: options.providerRunner,
      activityByProvider: {
        codex: "not_observed",
        claude: "not_observed",
      },
      signal: providerAbortController.signal,
    })
      .then((status) => {
        providerCache = status;
        const completedAt = Number(integrationNow());
        providerCacheAt = Number.isFinite(completedAt)
          ? completedAt
          : Date.now();
        return status;
      })
      .catch(() => UNKNOWN_PROVIDER_INTEGRATION)
      .finally(() => {
        providerProbe = null;
      });
    return providerProbe.then((status) =>
      withProviderActivity(status, currentProviderActivity())
    );
  };

  const server = http.createServer((request, response) => {
    try {
      if (!trustedRequestAuthority(request, actualPort)) {
        json(response, 403, { error: "forbidden" });
        return;
      }
      let requestUrl;
      try {
        requestUrl = new URL(request.url ?? "/", `http://${urlHost}`);
      } catch {
        json(response, 400, { error: "bad_request" });
        return;
      }

      if (request.method !== "GET") {
        json(response, 405, { error: "method_not_allowed" });
        return;
      }

      if (requestUrl.pathname === "/dashboard.css") {
        asset(response, "text/css; charset=utf-8", DASHBOARD_CSS);
        return;
      }
      if (requestUrl.pathname === "/dashboard.js") {
        asset(response, "text/javascript; charset=utf-8", DASHBOARD_JS);
        return;
      }
      if (DASHBOARD_ASSET_URLS.has(requestUrl.pathname)) {
        readDashboardAsset(
          loadDashboardAsset,
          requestUrl.pathname,
          dashboardAssetLoadTimeoutMs,
        ).then(
          (body) => {
            if (!response.destroyed && !response.writableEnded) {
              asset(response, "image/webp", body);
            }
          },
          () => {
            if (!response.destroyed && !response.writableEnded) {
              json(response, 503, { error: "asset_unavailable" });
            }
          },
        );
        return;
      }
      if (!authorized(requestUrl, token)) {
        json(response, 403, { error: "forbidden" });
        return;
      }
      if (requestUrl.pathname === "/") {
        asset(response, "text/html; charset=utf-8", DASHBOARD_HTML);
        return;
      }
      if (requestUrl.pathname === "/api/status") {
        json(response, 200, snapshotStatus());
        return;
      }
      if (requestUrl.pathname === "/api/integrations") {
        readProviderIntegration().then(
          (status) => json(response, 200, status),
          () => json(response, 200, UNKNOWN_PROVIDER_INTEGRATION),
        );
        return;
      }
      if (requestUrl.pathname === "/events") {
        serveEventStream(request, response, cursor, {
          activeStreams,
          observeProviderEvents,
          projectEvent,
          snapshotStatus,
          source,
        });
        return;
      }
      json(response, 404, { error: "not_found" });
    } catch {
      if (response.headersSent) {
        response.destroy();
      } else {
        json(response, 500, { error: "internal_error" });
      }
    }
  });
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  actualPort = typeof address === "object" && address ? address.port : port;
  if (source === "live" && typeof store.maintain === "function") {
    const requestedInterval = Number(options.maintenanceIntervalMs);
    const maintenanceIntervalMs =
      Number.isSafeInteger(requestedInterval) &&
      requestedInterval >= 25
        ? requestedInterval
        : 1000;
    maintenanceInterval = setInterval(
      () => {
        try {
          store.maintain();
          const events = cursor.readEvents();
          const snapshot = cursor.currentSnapshot();
          observeProviderEvents(
            events,
            snapshot.streamAlias,
            snapshot.initialized,
          );
        } catch {
          // A later audited poll may recover; never terminate the dashboard loop.
        }
      },
      maintenanceIntervalMs,
    );
    maintenanceInterval.unref?.();
  }
  const url = `http://${urlHost}:${actualPort}/?token=${token}`;
  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
    providerAbortController.abort();
    if (maintenanceInterval) {
      clearInterval(maintenanceInterval);
      maintenanceInterval = null;
    }
    closePromise = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      for (const response of activeStreams) {
        response.end();
      }
      for (const socket of activeSockets) {
        socket.destroy();
      }
    });
    return closePromise;
  };
  return {
    server,
    host,
    port: actualPort,
    source,
    traceId,
    token,
    url,
    close,
  };
}
