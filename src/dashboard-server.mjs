import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import {
  DASHBOARD_CSS,
  DASHBOARD_HTML,
  DASHBOARD_JS,
} from "./dashboard-assets.mjs";
import { DashboardTraceCursor } from "./dashboard-trace-cursor.mjs";
import { TraceStore } from "./trace-store.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DASHBOARD_TOKEN = /^[0-9a-f]{48}$/u;
const GUARDIAN_MARK = fs.readFileSync(
  new URL("../assets/guardian-mark.webp", import.meta.url),
);
const PAPER_GRID = fs.readFileSync(
  new URL("../assets/paper-grid.webp", import.meta.url),
);
const SENTINEL_EYE_CLEAR = fs.readFileSync(
  new URL("../assets/sentinel-eye-clear.webp", import.meta.url),
);
const SENTINEL_EYE_WARN = fs.readFileSync(
  new URL("../assets/sentinel-eye-warn.webp", import.meta.url),
);
const SENTINEL_EYE_CRITICAL = fs.readFileSync(
  new URL("../assets/sentinel-eye-critical.webp", import.meta.url),
);
const AVOIDABLE_RULES = new Set([
  "exact_tool_repeat",
  "unchanged_reread",
  "retry_after_same_failure",
  "repeated_failure_result",
  "status_polling_loop",
  "edit_revert_oscillation",
]);

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

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
};

function currentIncidentEvent(events) {
  const sessions = new Map();
  for (const event of events) {
    const current = sessions.get(event.sessionAlias);
    if (!current || event.progressVersion > current.progressVersion) {
      sessions.set(event.sessionAlias, {
        progressVersion: event.progressVersion,
        incidentEvent: event.incident ? event : null,
      });
      continue;
    }
    if (event.progressVersion === current.progressVersion && event.incident) {
      current.incidentEvent = event;
      continue;
    }
    if (
      event.progressVersion === current.progressVersion &&
      event.kind === "prompt" &&
      event.shouldWarn === false &&
      current.incidentEvent?.incident?.ruleId === "prompt_contract"
    ) {
      current.incidentEvent = null;
    }
  }

  let selected = null;
  for (const session of sessions.values()) {
    const candidate = session.incidentEvent;
    if (!candidate) continue;
    const candidateRank = SEVERITY_RANK[candidate.incident.severity] ?? 0;
    const selectedRank = selected
      ? (SEVERITY_RANK[selected.incident.severity] ?? 0)
      : -1;
    if (
      !selected ||
      candidateRank > selectedRank ||
      (candidateRank === selectedRank && candidate.seq > selected.seq)
    ) {
      selected = candidate;
    }
  }
  return selected;
}

function statusPayload(store, traceId, cursor) {
  const status = store.status(traceId);
  if (!status) {
    return {
      connected: false,
      mode: "observe",
      state: "idle",
      traceHealth: "healthy",
      traceId: null,
      label: null,
      metrics: {
        events: 0,
        incidents: 0,
        avoidableCalls: 0,
        elapsedMs: 0,
      },
    };
  }
  const events = cursor.readEvents();
  const latestIncidentEvent = currentIncidentEvent(events);
  const latestIncident = latestIncidentEvent?.incident ?? null;
  const latestPrompt = events.findLast((event) => event.kind === "prompt") ?? null;
  return {
    connected: true,
    mode: status.mode,
    state: status.status,
    traceHealth: cursor.health,
    traceId: status.traceId,
    traceAlias: status.traceId,
    metrics: {
      events: status.eventCount,
      incidents: status.incidentCount,
      avoidableCalls: status.avoidableCallCount,
      elapsedMs: status.elapsedMs,
    },
    lastSequence: events.at(-1)?.seq ?? 0,
    currentWarning: latestIncident
      ? {
          ruleId: latestIncident.ruleId,
          severity: latestIncident.severity,
          attribution: latestIncident.attribution,
          occurrences: latestIncident.repeatCount,
          issueIds:
            latestIncidentEvent?.kind === "prompt" &&
            latestIncident.ruleId === "prompt_contract"
              ? latestIncidentEvent.issueIds
              : [],
        }
      : null,
    promptCoach: {
      issueIds: latestPrompt?.issueIds ?? [],
    },
  };
}

function dashboardEvent(event) {
  const incident = event.incident;
  const kind = incident
    ? "incident"
    : event.madeProgress === true
      ? "progress"
    : event.kind === "prompt"
      ? "prompt"
      : event.kind === "stop"
        ? "system"
        : "tool";
  const outcome =
    event.kind === "tool_pre"
      ? "started"
      : event.kind === "tool_post"
        ? event.outcome === "failure"
          ? "failed"
          : event.outcome === "interrupted"
            ? "interrupted"
            : event.outcome === "success"
              ? "succeeded"
              : "observed"
        : event.decision === "block"
          ? "blocked"
          : event.decision === "warn"
            ? "warned"
            : event.decision === "observe"
              ? "observed"
              : "allowed";
  return {
    kind,
    family:
      event.kind === "prompt"
        ? "prompt"
        : event.kind === "stop"
          ? "system"
          : event.family,
    operation:
      event.kind === "prompt"
        ? "prompt"
        : event.kind === "stop"
          ? "progress"
          : event.operation,
    outcome,
    ruleId: incident?.ruleId ?? null,
    severity: incident?.severity ?? "none",
    attribution: incident?.attribution ?? null,
    alias: event.callAlias ?? event.sessionAlias,
    elapsedMs: event.elapsedMs,
    issueIds: event.kind === "prompt" ? event.issueIds : [],
    occurrences: incident?.repeatCount ?? 1,
    incidentCountDelta: incident?.notified === true ? 1 : 0,
    avoidableCallsDelta:
      incident?.notified && AVOIDABLE_RULES.has(incident.ruleId) ? 1 : 0,
  };
}

function serveEventStream(
  request,
  response,
  cursor,
  { activeStreams, snapshotStatus },
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

  const headerSequence = Number.parseInt(
    String(request.headers["last-event-id"] ?? "0"),
    10,
  );
  let lastSequence =
    Number.isSafeInteger(headerSequence) && headerSequence >= 0
      ? headerSequence
      : 0;
  let streamGeneration = null;
  let streamHealth = null;
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
      let window = cursor.readWindowAfter(lastSequence);
      if (streamHealth !== null && window.health !== streamHealth) {
        response.write("event: status\n");
        response.write(
          `data: ${JSON.stringify({ kind: "status", status: snapshotStatus() })}\n\n`,
        );
      }
      streamHealth = window.health;
      const reset =
        (streamGeneration !== null &&
          window.generation !== streamGeneration) ||
        lastSequence > window.lastSequence;
      streamGeneration = window.generation;
      if (reset) {
        lastSequence = 0;
        response.write("id:\n");
        response.write("event: snapshot\n");
        response.write(
          `data: ${JSON.stringify({ reset: true, status: snapshotStatus() })}\n\n`,
        );
        window = cursor.readWindowAfter(lastSequence);
        streamGeneration = window.generation;
        streamHealth = window.health;
      }
      for (const event of window.events) {
        response.write(`id: ${event.seq}\n`);
        response.write(`data: ${JSON.stringify(dashboardEvent(event))}\n\n`);
        lastSequence = event.seq;
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
  const store =
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
  const traceId = status.traceId;
  const token = safeToken(options.token);
  const cursor = new DashboardTraceCursor(store, traceId);
  cursor.readEvents();
  let actualPort = port;
  const urlHost = host === "::1" ? "[::1]" : host;
  const activeStreams = new Set();
  const activeSockets = new Set();

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
      if (requestUrl.pathname === "/assets/guardian-mark.webp") {
        asset(response, "image/webp", GUARDIAN_MARK);
        return;
      }
      if (requestUrl.pathname === "/assets/paper-grid.webp") {
        asset(response, "image/webp", PAPER_GRID);
        return;
      }
      if (requestUrl.pathname === "/assets/sentinel-eye-clear.webp") {
        asset(response, "image/webp", SENTINEL_EYE_CLEAR);
        return;
      }
      if (requestUrl.pathname === "/assets/sentinel-eye-warn.webp") {
        asset(response, "image/webp", SENTINEL_EYE_WARN);
        return;
      }
      if (requestUrl.pathname === "/assets/sentinel-eye-critical.webp") {
        asset(response, "image/webp", SENTINEL_EYE_CRITICAL);
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
        json(response, 200, statusPayload(store, traceId, cursor));
        return;
      }
      if (requestUrl.pathname === "/events") {
        serveEventStream(request, response, cursor, {
          activeStreams,
          snapshotStatus: () => statusPayload(store, traceId, cursor),
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
  const url = `http://${urlHost}:${actualPort}/?token=${token}`;
  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
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
    traceId,
    token,
    url,
    close,
  };
}
