const HANDSHAKE_KEYS = [
  "v",
  "workerProtocol",
  "runtime",
  "runtimeMajor",
];

export const HELPER_WORKER_HANDSHAKE_VERSION = 1;
export const NATIVE_WORKER_PROTOCOL = 1;
export const NATIVE_RUNTIME_MAJOR = 24;
export const PORTABLE_WORKER_ARGUMENTS = Object.freeze([
  "--awf-portable-protocol",
  String(NATIVE_WORKER_PROTOCOL),
]);
export const NATIVE_WORKER_ARGUMENTS = Object.freeze([
  "--awf-worker-protocol",
  String(NATIVE_WORKER_PROTOCOL),
  "--awf-runtime-major",
  String(NATIVE_RUNTIME_MAJOR),
]);

function fail(field) {
  throw new TypeError(`Invalid HelperWorkerHandshakeV1 at ${field}.`);
}

function runtimeMajor(version) {
  if (typeof version !== "string") fail("runtimeMajor");
  const match = /^([1-9][0-9]?)\./u.exec(version);
  if (!match) fail("runtimeMajor");
  return Number.parseInt(match[1], 10);
}

export function validateHelperWorkerHandshake(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail("handshake");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== HANDSHAKE_KEYS.length ||
    keys.some((key) => !HANDSHAKE_KEYS.includes(key)) ||
    HANDSHAKE_KEYS.some(
      (key) => !Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    fail("handshake");
  }
  if (value.v !== HELPER_WORKER_HANDSHAKE_VERSION) fail("v");
  if (value.workerProtocol !== NATIVE_WORKER_PROTOCOL) {
    fail("workerProtocol");
  }
  if (value.runtime !== "node") fail("runtime");
  if (value.runtimeMajor !== NATIVE_RUNTIME_MAJOR) {
    fail("runtimeMajor");
  }
  return value;
}

export function helperWorkerHandshake(
  nodeVersion = process.versions.node,
) {
  return validateHelperWorkerHandshake({
    v: HELPER_WORKER_HANDSHAKE_VERSION,
    workerProtocol: NATIVE_WORKER_PROTOCOL,
    runtime: "node",
    runtimeMajor: runtimeMajor(nodeVersion),
  });
}

export function canonicalHelperWorkerHandshake(
  value = {
    v: HELPER_WORKER_HANDSHAKE_VERSION,
    workerProtocol: NATIVE_WORKER_PROTOCOL,
    runtime: "node",
    runtimeMajor: NATIVE_RUNTIME_MAJOR,
  },
) {
  const handshake = validateHelperWorkerHandshake(value);
  return `${JSON.stringify({
    v: handshake.v,
    workerProtocol: handshake.workerProtocol,
    runtime: handshake.runtime,
    runtimeMajor: handshake.runtimeMajor,
  })}\n`;
}

export function nativeWorkerCompatible({
  arguments: workerArguments,
  nodeVersion = process.versions.node,
} = {}) {
  if (
    !Array.isArray(workerArguments) ||
    workerArguments.length !== NATIVE_WORKER_ARGUMENTS.length ||
    workerArguments.some(
      (argument, index) => argument !== NATIVE_WORKER_ARGUMENTS[index],
    )
  ) {
    return false;
  }
  try {
    const handshake = helperWorkerHandshake(nodeVersion);
    return handshake.runtimeMajor === NATIVE_RUNTIME_MAJOR;
  } catch {
    return false;
  }
}

export function workerInvocationCompatible({
  arguments: workerArguments,
  nodeVersion = process.versions.node,
} = {}) {
  if (
    Array.isArray(workerArguments) &&
    workerArguments.length === PORTABLE_WORKER_ARGUMENTS.length &&
    workerArguments.every(
      (argument, index) => argument === PORTABLE_WORKER_ARGUMENTS[index],
    )
  ) {
    try {
      return runtimeMajor(nodeVersion) >= 18;
    } catch {
      return false;
    }
  }
  return nativeWorkerCompatible({
    arguments: workerArguments,
    nodeVersion,
  });
}
