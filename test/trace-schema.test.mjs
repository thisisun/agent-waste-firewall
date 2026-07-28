import assert from "node:assert/strict";
import test from "node:test";

import {
  auditTraceText,
  serializeTraceEvent,
  validateTraceEvent,
} from "../src/trace-schema.mjs";

function alias(domain, character = "a") {
  return `${domain}_${character.repeat(32)}`;
}

function common(kind, overrides = {}) {
  return {
    v: 1,
    seq: 1,
    elapsedMs: 0,
    kind,
    platform: "codex",
    sessionAlias: alias("session"),
    decision: "allow",
    progressVersion: 0,
    ...overrides,
  };
}

function target(overrides = {}) {
  return {
    pathAlias: alias("path", "b"),
    fileType: "source",
    scope: "workspace",
    contentAlias: alias("content", "c"),
    contentState: "present",
    ...overrides,
  };
}

function tool(kind, overrides = {}) {
  return common(kind, {
    callAlias: alias("call", "d"),
    signatureAlias: alias("signature", "e"),
    family: "shell",
    operation: "test",
    risk: "none",
    targets: [],
    ...overrides,
  });
}

function prompt(overrides = {}) {
  return common("prompt", {
    promptAlias: alias("prompt", "f"),
    locale: "ko",
    score: 65,
    severity: "medium",
    shouldWarn: true,
    isAction: true,
    isFollowUp: false,
    issueIds: ["target", "verify"],
    ...overrides,
  });
}

function incident(overrides = {}) {
  return {
    ruleId: "exact_tool_repeat",
    attribution: "agent",
    severity: "medium",
    confidence: "high",
    repeatCount: 3,
    blockable: false,
    notified: true,
    ...overrides,
  };
}

test("accepts all four closed semantic event shapes", () => {
  const events = [
    prompt({
      turnAlias: alias("turn", "1"),
      incident: incident({
        ruleId: "prompt_contract",
        attribution: "user_instruction",
      }),
    }),
    tool("tool_pre", {
      operation: "sign",
      risk: "signing",
      targets: [target()],
      decision: "block",
      incident: incident({ blockable: true }),
    }),
    tool("tool_post", {
      seq: 2,
      elapsedMs: 8,
      resultAlias: alias("result", "2"),
      outcome: "failure",
      failureClass: "environment",
      madeProgress: false,
    }),
    common("stop", { seq: 3, elapsedMs: 9, decision: "observe" }),
  ];

  for (const event of events) {
    assert.equal(validateTraceEvent(event), event);
  }
});

test("allows the release operation and risk vocabularies without free text", () => {
  const operations = [
    "command",
    "test",
    "build",
    "verify",
    "release",
    "deploy",
    "sign",
    "submit",
    "migrate",
    "inspect",
    "wait",
    "read",
    "search",
    "write",
    "subagent",
    "other",
  ];
  const risks = [
    "none",
    "external_change",
    "production_change",
    "credential_access",
    "signing",
    "submission",
  ];

  for (const operation of operations) {
    validateTraceEvent(tool("tool_pre", { operation }));
  }
  for (const risk of risks) {
    validateTraceEvent(tool("tool_pre", { risk }));
  }
});

test("serializes a canonical JSONL line that passes its own audit", () => {
  const event = prompt();
  const serialized = serializeTraceEvent(event);

  assert.equal(serialized.endsWith("\n"), true);
  assert.equal(serialized.includes("전체 저장소"), false);
  assert.deepEqual(auditTraceText(serialized), {
    ok: true,
    eventCount: 1,
    findings: [],
  });

  const parsed = JSON.parse(serialized);
  assert.deepEqual(parsed, event);
  assert.equal(Object.keys(parsed)[0], "decision");
});

test("rejects unknown top-level, target, and incident fields", () => {
  const cases = [
    prompt({ rawPrompt: "must never be stored" }),
    tool("tool_pre", {
      targets: [target({ fileName: "secret-name.js" })],
    }),
    tool("tool_pre", {
      incident: incident({ message: "raw detector message" }),
    }),
  ];

  for (const event of cases) {
    assert.throws(
      () => validateTraceEvent(event),
      /unknown_field/u,
    );
  }
});

test("never echoes an unknown key or its value in validation diagnostics", () => {
  const unknownKey = "sk-proj-DO-NOT-ECHO-KEY";
  const secretValue = "ghp_DO_NOT_ECHO_THIS_SECRET_123456789";
  const event = prompt();
  event[unknownKey] = secretValue;

  assert.throws(
    () => validateTraceEvent(event),
    (error) => {
      assert.equal(error.code, "unknown_field");
      assert.equal(error.message.includes(unknownKey), false);
      assert.equal(error.message.includes(secretValue), false);
      return true;
    },
  );
});

test("rejects raw, short, uppercase, and wrong-domain aliases", () => {
  for (const sessionAlias of [
    "session-secret",
    "session_abc",
    `session_${"A".repeat(32)}`,
    alias("prompt"),
  ]) {
    assert.throws(
      () => validateTraceEvent(prompt({ sessionAlias })),
      /invalid_alias/u,
    );
  }
});

test("enforces content alias state without retaining file content", () => {
  validateTraceEvent(
    tool("tool_pre", {
      targets: [
        target(),
        target({
          pathAlias: alias("path", "3"),
          fileType: "config",
          contentAlias: null,
          contentState: "missing",
        }),
        target({
          pathAlias: alias("path", "4"),
          fileType: "binary",
          scope: "external",
          contentAlias: null,
          contentState: "unavailable",
        }),
        target({
          pathAlias: alias("path", "5"),
          fileType: "directory",
          contentAlias: null,
          contentState: "not_observed",
        }),
      ],
    }),
  );

  assert.throws(
    () =>
      validateTraceEvent(
        tool("tool_pre", {
          targets: [target({ contentAlias: null, contentState: "present" })],
        }),
      ),
    /missing_content_alias/u,
  );
  assert.throws(
    () =>
      validateTraceEvent(
        tool("tool_pre", {
          targets: [target({ contentState: "missing" })],
        }),
      ),
    /unexpected_content_alias/u,
  );
});

test("requires progressVersion for prompt and stop events", () => {
  const promptWithoutProgress = prompt();
  delete promptWithoutProgress.progressVersion;
  const stopWithoutProgress = common("stop");
  delete stopWithoutProgress.progressVersion;

  assert.throws(
    () => validateTraceEvent(promptWithoutProgress),
    /missing_field/u,
  );
  assert.throws(
    () => validateTraceEvent(stopWithoutProgress),
    /missing_field/u,
  );
});

test("rejects duplicate targets and prompt issue IDs", () => {
  assert.throws(
    () =>
      validateTraceEvent(
        tool("tool_pre", {
          targets: [target(), target({ fileType: "config" })],
        }),
      ),
    /duplicate_target/u,
  );
  assert.throws(
    () => validateTraceEvent(prompt({ issueIds: ["target", "target"] })),
    /duplicate_issue_id/u,
  );
});

test("requires failureClass only for failed post-tool outcomes", () => {
  validateTraceEvent(
    tool("tool_post", {
      resultAlias: null,
      outcome: "success",
      failureClass: null,
      madeProgress: true,
    }),
  );

  assert.throws(
    () =>
      validateTraceEvent(
        tool("tool_post", {
          resultAlias: alias("result"),
          outcome: "failure",
          failureClass: null,
          madeProgress: false,
        }),
      ),
    /missing_failure_class/u,
  );
  assert.throws(
    () =>
      validateTraceEvent(
        tool("tool_post", {
          resultAlias: null,
          outcome: "interrupted",
          failureClass: "agent",
          madeProgress: false,
        }),
      ),
    /unexpected_failure_class/u,
  );
});

test("rejects arbitrary enum strings and unsupported schema versions", () => {
  assert.throws(
    () => validateTraceEvent(tool("tool_pre", { operation: "npm test" })),
    /invalid_enum/u,
  );
  assert.throws(
    () => validateTraceEvent(tool("tool_pre", { risk: "probably-safe" })),
    /invalid_enum/u,
  );
  assert.throws(
    () => validateTraceEvent(prompt({ v: 2 })),
    /unsupported_version/u,
  );
});

test("audit rejects raw paths, URLs, emails, commands, and secrets without echoing them", () => {
  const rawValues = [
    "/Users/alice/private/example-project.ts",
    "C:\\Users\\alice\\Documents\\example-project.ts",
    "https://example.invalid/private/repo",
    "alice@example.invalid",
    "sk-proj-THIS_MUST_NEVER_APPEAR_123456",
    "API_TOKEN=THIS_MUST_NEVER_APPEAR",
  ];
  const unsafeLines = rawValues.map((rawValue, index) =>
    JSON.stringify({
      ...prompt({ seq: index + 1 }),
      rawPrompt: rawValue,
    }),
  );

  const audit = auditTraceText(`${unsafeLines.join("\n")}\n`);
  assert.equal(audit.ok, false);
  assert.ok(audit.findings.some((finding) => finding.code === "unknown_field"));
  assert.ok(
    audit.findings.some((finding) =>
      [
        "possible_posix_path",
        "possible_windows_path",
        "possible_url",
        "possible_email",
        "possible_secret",
        "possible_secret_assignment",
      ].includes(finding.code),
    ),
  );
  const report = JSON.stringify(audit);
  for (const rawValue of rawValues) {
    assert.equal(report.includes(rawValue), false);
  }
  assert.equal(report.includes("rawPrompt"), false);
});

test("audit reports malformed JSON without copying parser input", () => {
  const raw = '{"prompt":"SUPER-SECRET-INVALID-JSON"';
  const audit = auditTraceText(raw);

  assert.deepEqual(audit, {
    ok: false,
    eventCount: 0,
    findings: [{ line: 1, code: "invalid_json" }],
  });
  assert.equal(JSON.stringify(audit).includes("SUPER-SECRET"), false);
});

test("audit accepts multiple pseudonymous sessions in one workspace trace", () => {
  const lines = [
    serializeTraceEvent(prompt({ seq: 1, elapsedMs: 10 })),
    serializeTraceEvent(
      common("stop", {
        seq: 2,
        elapsedMs: 20,
        sessionAlias: alias("session", "9"),
      }),
    ),
  ].join("");

  assert.deepEqual(auditTraceText(lines), {
    ok: true,
    eventCount: 2,
    findings: [],
  });
});

test("audit still detects reordered events and decreasing time across sessions", () => {
  const lines = [
    serializeTraceEvent(prompt({ seq: 2, elapsedMs: 20 })),
    serializeTraceEvent(
      common("stop", {
        seq: 1,
        elapsedMs: 10,
        sessionAlias: alias("session", "9"),
      }),
    ),
  ].join("");
  const audit = auditTraceText(lines);

  assert.equal(audit.ok, false);
  assert.equal(audit.eventCount, 2);
  assert.deepEqual(
    audit.findings.map((finding) => finding.code),
    ["sequence_not_increasing", "elapsed_time_decreased"],
  );
});

test("audit rejects empty and non-text traces without throwing", () => {
  assert.deepEqual(auditTraceText("\n"), {
    ok: false,
    eventCount: 0,
    findings: [{ line: 0, code: "empty_trace" }],
  });
  assert.deepEqual(auditTraceText(Buffer.from("not text")), {
    ok: false,
    eventCount: 0,
    findings: [{ line: 0, code: "expected_text" }],
  });
});
