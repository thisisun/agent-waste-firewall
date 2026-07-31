const READY_KEYS = [
  "v",
  "kind",
  "host",
  "port",
  "token",
  "source",
];
const TOKEN = /^[0-9a-f]{48}$/u;
const SOURCES = new Set(["live", "trace"]);

function fail(field) {
  throw new TypeError(`Invalid DashboardReadyV1 at ${field}.`);
}

export function validateDashboardReady(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("ready");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== READY_KEYS.length ||
    keys.some((key) => !READY_KEYS.includes(key)) ||
    READY_KEYS.some(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    fail("ready");
  }
  if (value.v !== 1) fail("ready.v");
  if (value.kind !== "dashboard_ready") fail("ready.kind");
  if (value.host !== "127.0.0.1") fail("ready.host");
  if (
    !Number.isSafeInteger(value.port) ||
    value.port < 1 ||
    value.port > 65_535
  ) {
    fail("ready.port");
  }
  if (typeof value.token !== "string" || !TOKEN.test(value.token)) {
    fail("ready.token");
  }
  if (!SOURCES.has(value.source)) fail("ready.source");
  return value;
}

export function dashboardReady({
  host,
  port,
  token,
  source,
}) {
  return validateDashboardReady({
    v: 1,
    kind: "dashboard_ready",
    host,
    port,
    token,
    source,
  });
}
