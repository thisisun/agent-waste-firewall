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
import { DashboardTraceCursor } from "./dashboard-trace-cursor.mjs";
import { LiveEventStore } from "./live-event-store.mjs";
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
      liveStatusPayload(cursor, snapshot);
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
      traceStatusPayload(store, traceId, cursor, snapshot);
  }
  let actualPort = port;
  const urlHost = host === "::1" ? "[::1]" : host;
  const activeStreams = new Set();
  const activeSockets = new Set();
  let maintenanceInterval = null;

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
        json(response, 200, snapshotStatus());
        return;
      }
      if (requestUrl.pathname === "/events") {
        serveEventStream(request, response, cursor, {
          activeStreams,
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
      () => store.maintain(),
      maintenanceIntervalMs,
    );
    maintenanceInterval.unref?.();
  }
  const url = `http://${urlHost}:${actualPort}/?token=${token}`;
  let closePromise = null;
  const close = () => {
    if (closePromise) return closePromise;
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
