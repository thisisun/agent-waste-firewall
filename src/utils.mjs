import crypto from "node:crypto";

export function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

export function hash(value, key = null) {
  const input = Buffer.isBuffer(value)
    ? value
    : typeof value === "string"
      ? value
      : stableStringify(value);
  const digest =
    key === null
      ? crypto.createHash("sha256")
      : crypto.createHmac("sha256", String(key));
  return digest.update(input).digest("hex");
}

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectLocale(text) {
  return /[\u3131-\u318e\uac00-\ud7a3]/u.test(String(text ?? "")) ? "ko" : "en";
}

export function safeIdentifier(value) {
  const normalized = String(value ?? "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  return normalized.slice(0, 96) || "unknown";
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function compactText(value, maxLength = 240) {
  const normalized = normalizeWhitespace(value);
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}
