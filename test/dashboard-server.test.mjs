import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configFromEnv } from "../src/config.mjs";
import { startDashboard } from "../src/dashboard-server.mjs";
import { handleHook } from "../src/engine.mjs";
import { StateStore } from "../src/state-store.mjs";
import { TraceStore } from "../src/trace-store.mjs";

function requestStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
  });
}

function requestTargetStatus(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: target,
        headers: { host: `127.0.0.1:${port}` },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function readStreamUntil(reader, marker) {
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(marker)) {
    const current = await withTimeout(
      reader.read(),
      2_000,
      `Timed out waiting for SSE marker: ${marker}`,
    );
    if (current.done) break;
    text += decoder.decode(current.value, { stream: true });
  }
  return text;
}

function appendHook(traceStore, stateStore, config, env, payload) {
  const result = handleHook(payload, {
    env,
    config,
    store: stateStore,
  });
  traceStore.appendHook(payload, result, config);
  return result;
}

function appendProgress({
  traceStore,
  stateStore,
  config,
  env,
  workspace,
  sessionId,
  turnId,
  callId,
}) {
  const progressTarget = path.join(workspace, `${callId}.txt`);
  fs.writeFileSync(progressTarget, "before\n");
  const prePayload = {
    session_id: sessionId,
    cwd: workspace,
    hook_event_name: "PreToolUse",
    turn_id: turnId,
    tool_name: "apply_patch",
    tool_use_id: callId,
    tool_input: {
      command: `*** Begin Patch\n*** Update File: ${callId}.txt\n*** End Patch`,
    },
  };
  appendHook(traceStore, stateStore, config, env, prePayload);
  fs.writeFileSync(progressTarget, "after\n");
  appendHook(traceStore, stateStore, config, env, {
    ...prePayload,
    hook_event_name: "PostToolUse",
    tool_response: { success: true },
  });
}

test("serves a token-protected loopback dashboard and semantic SSE", async (context) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "awf-dashboard-workspace-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "awf-dashboard-data-"));
  fs.mkdirSync(path.join(workspace, ".git"));
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "observe",
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const config = configFromEnv(env);
  const stateStore = new StateStore({ root: dataDir });
  const traceStore = new TraceStore({ root: dataDir, env });
  traceStore.start({
    workspace,
    label: "SECRET-CUSTOMER-DASHBOARD-LABEL",
    mode: "observe",
  });

  const payload = {
    session_id: "SECRET-DASHBOARD-SESSION",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "turn-1",
    prompt: "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마",
  };
  const result = handleHook(payload, {
    env,
    config,
    store: stateStore,
  });
  traceStore.appendHook(payload, result, config);

  let strictReadCount = 0;
  const strictReadEvents = traceStore.readEvents.bind(traceStore);
  traceStore.readEvents = (...args) => {
    strictReadCount += 1;
    return strictReadEvents(...args);
  };
  await assert.rejects(
    startDashboard({
      store: traceStore,
      port: 0,
      token: "",
    }),
    /48 lowercase hexadecimal/u,
  );
  const token = "a".repeat(48);
  const dashboard = await startDashboard({
    store: traceStore,
    port: 0,
    token,
  });
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.port}`;
  assert.equal(strictReadCount, 1);

  const forbidden = await fetch(`${origin}/api/status`);
  assert.equal(forbidden.status, 403);
  const wrongLengthToken = await fetch(`${origin}/api/status?token=wrong`);
  assert.equal(wrongLengthToken.status, 403);
  const wrongEqualLengthToken = await fetch(
    `${origin}/api/status?token=${"b".repeat(48)}`,
  );
  assert.equal(wrongEqualLengthToken.status, 403);
  const hostileHostStatus = await requestStatus(
    `${origin}/api/status?token=${token}`,
    { host: "dashboard.attacker.example" },
  );
  assert.equal(hostileHostStatus, 403);
  const hostileOrigin = await fetch(`${origin}/api/status?token=${token}`, {
    headers: { origin: "https://attacker.example" },
  });
  assert.equal(hostileOrigin.status, 403);
  const malformedTarget = await requestTargetStatus(dashboard.port, "//[");
  assert.equal(malformedTarget, 400);
  const trustedOrigin = await fetch(`${origin}/api/status?token=${token}`, {
    headers: { origin },
  });
  assert.equal(trustedOrigin.status, 200);

  const page = await fetch(`${origin}/?token=${token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Agent Waste Firewall/u);
  assert.match(
    page.headers.get("content-security-policy"),
    /default-src 'none'/u,
  );

  for (const asset of ["/dashboard.css", "/dashboard.js"]) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 100);
  }
  for (const asset of [
    "/assets/guardian-mark.webp",
    "/assets/paper-grid.webp",
    "/assets/sentinel-eye-clear.webp",
    "/assets/sentinel-eye-warn.webp",
    "/assets/sentinel-eye-critical.webp",
  ]) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }

  const statusResponse = await fetch(`${origin}/api/status?token=${token}`);
  const status = await statusResponse.json();
  assert.equal(status.connected, true);
  assert.equal(status.traceHealth, "healthy");
  assert.equal(status.metrics.events, 1);
  assert.equal(status.lastSequence, 1);
  assert.equal(status.currentWarning.ruleId, "prompt_contract");
  assert.match(status.currentWarning.severity, /^(?:low|medium|high)$/u);
  assert.deepEqual(status.promptCoach.issueIds.sort(), [
    "broad",
    "stop",
    "success",
    "target",
    "verify",
  ]);
  assert.equal(JSON.stringify(status).includes("SECRET-DASHBOARD-SESSION"), false);
  assert.equal(
    JSON.stringify(status).includes("SECRET-CUSTOMER-DASHBOARD-LABEL"),
    false,
  );
  const unchangedStatusResponse = await fetch(
    `${origin}/api/status?token=${token}`,
  );
  assert.equal(unchangedStatusResponse.status, 200);
  await unchangedStatusResponse.json();
  assert.equal(strictReadCount, 1);

  const progressTarget = path.join(workspace, "progress.txt");
  fs.writeFileSync(progressTarget, "before\n");
  const prePayload = {
    session_id: "SECRET-DASHBOARD-SESSION",
    cwd: workspace,
    hook_event_name: "PreToolUse",
    turn_id: "turn-1",
    tool_name: "apply_patch",
    tool_use_id: "progress-edit",
    tool_input: {
      command: "*** Begin Patch\n*** Update File: progress.txt\n*** End Patch",
    },
  };
  const preResult = handleHook(prePayload, {
    env,
    config,
    store: stateStore,
  });
  traceStore.appendHook(prePayload, preResult, config);
  fs.writeFileSync(progressTarget, "after\n");
  const postPayload = {
    ...prePayload,
    hook_event_name: "PostToolUse",
    tool_response: { success: true },
  };
  const postResult = handleHook(postPayload, {
    env,
    config,
    store: stateStore,
  });
  traceStore.appendHook(postPayload, postResult, config);

  const progressedStatusResponse = await fetch(
    `${origin}/api/status?token=${token}`,
  );
  const progressedStatus = await progressedStatusResponse.json();
  assert.equal(progressedStatus.currentWarning, null);
  assert.equal(progressedStatus.lastSequence, 3);
  assert.equal(strictReadCount, 1);
  assert.equal(
    JSON.stringify(progressedStatus).includes("SECRET-DASHBOARD-SESSION"),
    false,
  );

  for (let index = 1; index <= 6; index += 1) {
    const repeatPayload = {
      session_id: "SECRET-DASHBOARD-SESSION",
      cwd: workspace,
      hook_event_name: "PreToolUse",
      turn_id: "turn-2",
      tool_name: "Bash",
      tool_use_id: `repeat-${index}`,
      tool_input: { command: "git status --short" },
    };
    const repeatResult = handleHook(repeatPayload, {
      env,
      config,
      store: stateStore,
    });
    traceStore.appendHook(repeatPayload, repeatResult, config);
  }

  const criticalStatusResponse = await fetch(
    `${origin}/api/status?token=${token}`,
  );
  const criticalStatus = await criticalStatusResponse.json();
  assert.equal(criticalStatus.currentWarning.severity, "high");
  assert.equal(criticalStatus.currentWarning.occurrences, 3);
  assert.equal(strictReadCount, 1);

  const streamResponse = await fetch(`${origin}/events?token=${token}`);
  assert.equal(streamResponse.status, 200);
  const reader = streamResponse.body.getReader();
  let chunk = "";
  while (!chunk.includes("id: 9\n")) {
    const current = await reader.read();
    if (current.done) break;
    chunk += new TextDecoder().decode(current.value);
  }
  assert.match(chunk, /"kind":"incident"/u);
  assert.match(chunk, /"ruleId":"prompt_contract"/u);
  assert.match(chunk, /"incidentCountDelta":1/u);
  assert.equal(chunk.includes(payload.prompt), false);
  assert.equal(chunk.includes("SECRET-CUSTOMER-DASHBOARD-LABEL"), false);
  const repeatEvents = chunk
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((event) => event.ruleId === "exact_tool_repeat");
  assert.deepEqual(
    repeatEvents.map((event) => event.incidentCountDelta),
    [1, 1, 0, 0],
  );
  assert.equal(strictReadCount, 1);
  await reader.cancel();

  const closingStream = await fetch(`${origin}/events?token=${token}`);
  assert.equal(closingStream.status, 200);
  const closingReader = closingStream.body.getReader();
  await closingReader.read();
  await withTimeout(
    dashboard.close(),
    1_000,
    "Dashboard close waited for an active SSE connection.",
  );
});

test("keeps current warnings isolated by session progress and ranks severity", async (context) => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-multisession-workspace-"),
  );
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-multisession-data-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "observe",
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const config = configFromEnv(env);
  const stateStore = new StateStore({ root: dataDir });
  const traceStore = new TraceStore({ root: dataDir, env });
  traceStore.start({
    workspace,
    label: "multi-session",
    mode: "observe",
  });

  appendHook(traceStore, stateStore, config, env, {
    session_id: "session-high",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "high-turn",
    prompt: "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마",
  });
  appendHook(traceStore, stateStore, config, env, {
    session_id: "session-medium",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "medium-turn",
    prompt: "implement authentication and authorization and logging",
  });

  const token = "c".repeat(48);
  const dashboard = await startDashboard({
    store: traceStore,
    port: 0,
    token,
  });
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.port}`;

  const highStatus = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );
  assert.equal(highStatus.currentWarning.severity, "high");

  appendProgress({
    traceStore,
    stateStore,
    config,
    env,
    workspace,
    sessionId: "session-medium",
    turnId: "medium-turn",
    callId: "medium-progress",
  });
  const isolatedStatus = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );
  assert.equal(isolatedStatus.currentWarning.severity, "high");

  appendProgress({
    traceStore,
    stateStore,
    config,
    env,
    workspace,
    sessionId: "session-high",
    turnId: "high-turn",
    callId: "high-progress",
  });
  const clearedStatus = await fetch(`${origin}/api/status?token=${token}`).then(
    (response) => response.json(),
  );
  assert.equal(clearedStatus.currentWarning, null);

  appendProgress({
    traceStore,
    stateStore,
    config,
    env,
    workspace,
    sessionId: "session-medium",
    turnId: "medium-turn",
    callId: "medium-progress-again",
  });
  const stillClearedStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(stillClearedStatus.currentWarning, null);

  appendHook(traceStore, stateStore, config, env, {
    session_id: "session-high",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "high-turn-2",
    prompt: "전체 저장소를 알아서 개선하고 끝날 때까지 멈추지 마",
  });
  const repeatedHighStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(repeatedHighStatus.currentWarning.severity, "high");

  appendHook(traceStore, stateStore, config, env, {
    session_id: "session-high",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "high-turn-3",
    prompt: "Fix the TypeError in src/auth/login.ts and verify with npm test.",
  });
  const correctedPromptStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(correctedPromptStatus.currentWarning, null);
  assert.deepEqual(correctedPromptStatus.promptCoach.issueIds, []);
});

test("accepts only complete audited appends and recovers from truncation", async (context) => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-cursor-workspace-"),
  );
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-cursor-data-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "observe",
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const config = configFromEnv(env);
  const stateStore = new StateStore({ root: dataDir });
  const traceStore = new TraceStore({ root: dataDir, env });
  const trace = traceStore.start({
    workspace,
    label: "cursor-integrity",
    mode: "observe",
  });
  appendHook(traceStore, stateStore, config, env, {
    session_id: "cursor-session",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    turn_id: "cursor-turn",
    prompt: "Fix src/auth.ts and verify with npm test.",
  });

  let strictReadCount = 0;
  const strictReadEvents = traceStore.readEvents.bind(traceStore);
  traceStore.readEvents = (...args) => {
    strictReadCount += 1;
    return strictReadEvents(...args);
  };
  const token = "d".repeat(48);
  const dashboard = await startDashboard({
    store: traceStore,
    port: 0,
    token,
  });
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.port}`;
  const eventsPath = traceStore.eventsPath(trace.traceId);
  const firstEventText = fs.readFileSync(eventsPath);

  appendHook(traceStore, stateStore, config, env, {
    session_id: "cursor-session",
    cwd: workspace,
    hook_event_name: "PreToolUse",
    turn_id: "cursor-turn",
    tool_name: "Bash",
    tool_use_id: "cursor-call",
    tool_input: { command: "npm test" },
  });
  const twoEventText = fs.readFileSync(eventsPath);
  const appendedEvent = twoEventText.subarray(firstEventText.length);
  const splitAt = Math.floor(appendedEvent.length / 2);
  fs.writeFileSync(eventsPath, firstEventText);
  fs.appendFileSync(eventsPath, appendedEvent.subarray(0, splitAt));

  const partialStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(partialStatus.lastSequence, 1);
  assert.equal(partialStatus.traceHealth, "healthy");
  assert.equal(strictReadCount, 1);

  fs.appendFileSync(eventsPath, appendedEvent.subarray(splitAt));
  const completeStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(completeStatus.lastSequence, 2);
  assert.equal(completeStatus.traceHealth, "healthy");
  assert.equal(strictReadCount, 1);

  const streamResponse = await fetch(`${origin}/events?token=${token}`);
  assert.equal(streamResponse.status, 200);
  const reader = streamResponse.body.getReader();
  const initialStream = await readStreamUntil(reader, "id: 2\n");
  assert.match(initialStream, /id: 1\n/u);

  const duplicateBoundaryEvent = {
    ...JSON.parse(appendedEvent.toString("utf8")),
    seq: 2,
  };
  fs.appendFileSync(eventsPath, `${JSON.stringify(duplicateBoundaryEvent)}\n`);
  const rejectedStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(rejectedStatus.lastSequence, 2);
  assert.equal(rejectedStatus.traceHealth, "degraded");
  assert.equal(strictReadCount, 1);
  const degradedStream = await readStreamUntil(
    reader,
    '"traceHealth":"degraded"',
  );
  assert.match(degradedStream, /event: status/u);
  assert.equal(degradedStream.includes("Fix src/auth.ts"), false);
  assert.equal(degradedStream.includes("cursor-session"), false);

  fs.truncateSync(eventsPath, firstEventText.length);
  const truncatedStatus = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.json());
  assert.equal(truncatedStatus.lastSequence, 1);
  assert.equal(truncatedStatus.traceHealth, "healthy");
  assert.equal(strictReadCount, 2);

  const resetStream = await readStreamUntil(reader, "id: 1\n");
  assert.match(resetStream, /id:\nevent: snapshot\n/u);
  assert.match(resetStream, /"reset":true/u);
  assert.match(resetStream, /"traceHealth":"healthy"/u);
  assert.equal(resetStream.includes("Fix src/auth.ts"), false);
  assert.equal(resetStream.includes("cursor-session"), false);
  await reader.cancel();
});

test("never forwards tampered explicit-trace metadata to status or SSE", async (context) => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-metadata-workspace-"),
  );
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "awf-dashboard-metadata-data-"),
  );
  fs.mkdirSync(path.join(workspace, ".git"));
  context.after(() =>
    fs.rmSync(workspace, { recursive: true, force: true }),
  );
  context.after(() =>
    fs.rmSync(dataDir, { recursive: true, force: true }),
  );
  const env = {
    AGENT_WASTE_FIREWALL_DATA_DIR: dataDir,
    AGENT_WASTE_FIREWALL_MODE: "observe",
    AGENT_WASTE_FIREWALL_PLATFORM: "codex",
  };
  const store = new TraceStore({ root: dataDir, env });
  const trace = store.start({
    workspace,
    label: "metadata-audit",
    mode: "observe",
  });
  const token = "6".repeat(48);
  const dashboard = await startDashboard({
    source: "trace",
    store,
    traceId: trace.traceId,
    port: 0,
    token,
  });
  context.after(() => dashboard.close());
  const canary = "SECRET-TRACE-METADATA-CANARY";
  const metadataPath = store.metadataPath(trace.traceId);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify({
      ...metadata,
      traceId: canary,
      mode: canary,
      status: canary,
    })}\n`,
    { mode: 0o600 },
  );
  const origin = `http://127.0.0.1:${dashboard.port}`;

  const statusText = await fetch(
    `${origin}/api/status?token=${token}`,
  ).then((response) => response.text());
  assert.equal(statusText.includes(canary), false);
  const status = JSON.parse(statusText);
  assert.equal(status.connected, false);
  assert.equal(status.streamHealth, "degraded");

  const stream = await fetch(`${origin}/events?token=${token}`);
  const reader = stream.body.getReader();
  const streamText = await readStreamUntil(
    reader,
    '"streamHealth":"degraded"',
  );
  assert.equal(streamText.includes(canary), false);
  await reader.cancel();
});
