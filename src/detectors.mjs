import fs from "node:fs";
import path from "node:path";

import { hash } from "./utils.mjs";

function localized(locale, ko, en) {
  return locale === "ko" ? ko : en;
}

function incident({
  state,
  now,
  ruleId,
  severity,
  category,
  confidence,
  message,
  recommendation,
  evidence,
  signature,
  progressVersion = state.progressVersion,
  blockable = false,
}) {
  const dedupeKey = `incident_${hash([
    ruleId,
    signature ?? "none",
    progressVersion,
    severity,
    blockable ? "block" : "warn",
  ].join(":")).slice(0, 32)}`;
  const existing = state.incidents.find((item) => item.dedupeKey === dedupeKey);
  if (existing) {
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    existing.lastSeenAt = now;
    return {
      ...existing,
      message,
      recommendation,
      shouldNotify: false,
    };
  }

  const created = {
    id: hash(`${dedupeKey}:${now}`).slice(0, 16),
    dedupeKey,
    ruleId,
    category,
    severity,
    confidence,
    at: now,
    lastSeenAt: now,
    occurrences: 1,
    evidence,
    blockable,
  };
  state.incidents.push(created);
  return {
    ...created,
    message,
    recommendation,
    shouldNotify: true,
  };
}

function projectPath(cwd, filePath) {
  const root = path.resolve(cwd);
  const candidate = path.resolve(root, filePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return candidate;
}

function fileDigest(absolutePath, hashScope) {
  try {
    const stat = fs.lstatSync(absolutePath);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size > 10 * 1024 * 1024
    ) {
      return "unavailable";
    }
    return hash(fs.readFileSync(absolutePath), hashScope);
  } catch (error) {
    return error.code === "ENOENT" ? "missing" : "unavailable";
  }
}

function recordFileHash(state, cwd, filePath, source, now, hashScope) {
  const absolutePath = projectPath(cwd, filePath);
  if (!absolutePath) {
    return null;
  }
  const relativePath = path.relative(path.resolve(cwd), absolutePath) || ".";
  const pathAlias = `path_${hash(`path:${relativePath}`, hashScope).slice(0, 32)}`;
  const digest = fileDigest(absolutePath, hashScope);
  const entry = state.files[pathAlias] ?? { hashes: [] };
  const last = entry.hashes.at(-1);
  if (!last || last.hash !== digest) {
    entry.hashes.push({ hash: digest, source, at: now });
  }
  state.files[pathAlias] = entry;
  return { pathAlias, digest, previous: last?.hash ?? null };
}

function detectOscillation(file) {
  const hashes = file.hashes.map((item) => item.hash);
  const lastThree = hashes.slice(-3);
  return (
    lastThree.length === 3 &&
    lastThree[0] === lastThree[2] &&
    lastThree[0] !== lastThree[1]
  );
}

function recentPostEvents(state, tool) {
  return state.toolEvents.filter(
    (entry) =>
      entry.phase === "post" &&
      entry.signature === tool.signature &&
      entry.progressVersion === state.progressVersion,
  );
}

function identicalFailureStreak(state, tool) {
  const posts = recentPostEvents(state, tool);
  const latest = posts.at(-1);
  if (
    !latest?.failed ||
    latest.interrupted ||
    !latest.resultFingerprint
  ) {
    return { count: 0, category: "agent" };
  }

  let count = 0;
  for (let index = posts.length - 1; index >= 0; index -= 1) {
    const current = posts[index];
    if (
      !current.failed ||
      current.interrupted ||
      current.resultFingerprint !== latest.resultFingerprint
    ) {
      break;
    }
    count += 1;
  }
  return {
    count,
    category: latest.failureCategory ?? "agent",
  };
}

function previousComparablePost(state, tool) {
  for (let index = state.toolEvents.length - 1; index >= 0; index -= 1) {
    const current = state.toolEvents[index];
    if (current.phase === "post" && current.signature === tool.signature) {
      return current;
    }
  }
  return null;
}

export function applyPreTool(state, tool, config, now, cwd, hashScope) {
  if (tool.family === "write") {
    for (const filePath of tool.filePaths) {
      recordFileHash(state, cwd, filePath, "before-write", now, hashScope);
    }
  }

  const sameProgress = state.toolEvents.filter(
    (entry) => entry.phase === "pre" && entry.progressVersion === state.progressVersion,
  );
  const exactRepeatCount =
    sameProgress.filter((entry) => entry.signature === tool.signature).length + 1;
  const highCostOperation =
    tool.family === "shell" &&
    ["test", "build", "verify", "release"].includes(tool.operation);
  const repeatWarnAt = highCostOperation
    ? Math.min(config.repeatWarnAt, config.highCostRepeatWarnAt)
    : config.repeatWarnAt;
  const failureStreak = identicalFailureStreak(state, tool);
  const failedAttempts = failureStreak.count;
  const waitCount =
    sameProgress.filter(
      (entry) => entry.family === "wait" && entry.signature === tool.signature,
    ).length +
    (tool.family === "wait" ? 1 : 0);
  let detected = null;

  if (failedAttempts >= config.failedAttemptsBeforeBlock) {
    detected = incident({
      state,
      now,
      ruleId: "retry_after_same_failure",
      severity: "high",
      category: failureStreak.category,
      confidence: "high",
      signature: tool.signature,
      blockable: true,
      message: localized(
        state.locale,
        `상태 변화 없이 같은 실패 뒤에 ${tool.display}을(를) 다시 실행하려고 합니다.`,
        `${tool.display} is being retried after the same failure without a state change.`,
      ),
      recommendation: localized(
        state.locale,
        "동일 호출을 다시 시도하지 말고 실패 원인을 바꾸거나 현재 작업을 중단해 보고하세요.",
        "Do not retry the identical call. Change the suspected cause or stop this task and report it.",
      ),
      evidence: {
        repeatedFailedAttempts: failedAttempts,
        repositoryProgressSinceFailure: false,
        failureCategory: failureStreak.category,
      },
    });
  } else if (tool.family === "wait" && waitCount >= config.waitWarnAt) {
    detected = incident({
      state,
      now,
      ruleId: "status_polling_loop",
      severity: waitCount >= config.waitBlockAt ? "high" : "medium",
      category: "harness",
      confidence: "high",
      signature: "wait-family",
      blockable: waitCount >= config.waitBlockAt,
      message: localized(
        state.locale,
        `새 상태 변화 없이 대기·상태 확인이 ${waitCount}회 이어졌습니다.`,
        `Wait or status polling continued ${waitCount} times without a state change.`,
      ),
      recommendation: localized(
        state.locale,
        "같은 결과라면 대기 간격을 늘리고 새 출력이나 완료 이벤트가 생길 때까지 기다리세요.",
        "If the result is unchanged, increase the wait interval and wait for new output or completion.",
      ),
      evidence: {
        pollingCalls: waitCount,
        repositoryProgressDuringPolling: false,
      },
    });
  } else if (
    (tool.family === "read" || tool.family === "search") &&
    exactRepeatCount >= config.readWarnAt
  ) {
    detected = incident({
      state,
      now,
      ruleId: "unchanged_reread",
      severity: "medium",
      category: "agent",
      confidence: "medium",
      signature: tool.signature,
      message: localized(
        state.locale,
        `${tool.display}을(를) 상태 변화 없이 ${exactRepeatCount}번째 다시 확인하고 있습니다.`,
        `${tool.display} has been inspected ${exactRepeatCount} times without progress.`,
      ),
      recommendation: localized(
        state.locale,
        "이미 얻은 결과를 사용하거나 필요한 범위만 좁혀서 읽으세요.",
        "Use the result already obtained or narrow the next read to the missing range.",
      ),
      evidence: {
        identicalReads: exactRepeatCount,
        repositoryProgressBetweenReads: false,
      },
    });
  } else if (
    tool.family !== "write" &&
    exactRepeatCount >= repeatWarnAt
  ) {
    detected = incident({
      state,
      now,
      ruleId: "exact_tool_repeat",
      severity: exactRepeatCount >= config.repeatBlockAt ? "high" : "medium",
      category: "agent",
      confidence: "high",
      signature: tool.signature,
      blockable: exactRepeatCount >= config.repeatBlockAt,
      message: localized(
        state.locale,
        `${tool.display}과(와) 동일한 호출이 상태 변화 없이 ${exactRepeatCount}회 반복됐습니다.`,
        `The same ${tool.display} call repeated ${exactRepeatCount} times without progress.`,
      ),
      recommendation: localized(
        state.locale,
        "직전 결과를 재사용하거나 접근 방식을 바꾸세요.",
        "Reuse the previous result or change the approach.",
      ),
      evidence: {
        identicalCalls: exactRepeatCount,
        repositoryProgressBetweenCalls: false,
        highCostOperation,
      },
    });
  }

  state.toolEvents.push({
    phase: "pre",
    at: now,
    family: tool.family,
    operation: tool.operation,
    signature: tool.signature,
    progressVersion: state.progressVersion,
  });

  return detected;
}

export function applyPostTool(state, tool, config, now, cwd, hashScope) {
  let detected = null;
  let madeProgress = false;
  const previousPost = previousComparablePost(state, tool);

  if (tool.interrupted) {
    madeProgress = true;
    state.counters.interruptions = (state.counters.interruptions ?? 0) + 1;
  } else if (tool.failed) {
    state.failures.push({
      at: now,
      signature: tool.signature,
      resultFingerprint: tool.resultFingerprint,
      progressVersion: state.progressVersion,
    });
    let repeatedFailures = 1;
    const posts = recentPostEvents(state, tool);
    for (let index = posts.length - 1; index >= 0; index -= 1) {
      const current = posts[index];
      if (
        !current.failed ||
        current.interrupted ||
        current.resultFingerprint !== tool.resultFingerprint
      ) {
        break;
      }
      repeatedFailures += 1;
    }
    if (repeatedFailures >= config.failedAttemptsBeforeBlock + 1) {
      detected = incident({
        state,
        now,
        ruleId: "repeated_failure_result",
        severity: "high",
        category: tool.failureCategory ?? "agent",
        confidence: "high",
        signature: tool.signature,
        message: localized(
          state.locale,
          `같은 실패 결과가 ${repeatedFailures}회 반복됐고 저장소 상태는 바뀌지 않았습니다.`,
          `The same failure result repeated ${repeatedFailures} times without repository progress.`,
        ),
        recommendation: localized(
          state.locale,
          "재시도를 멈추고 오류 원인, 의존성 또는 환경 상태를 다시 진단하세요.",
          "Stop retrying and reassess the root cause, dependency, or environment.",
        ),
        evidence: {
          identicalFailureResults: repeatedFailures,
          repositoryProgressBetweenFailures: false,
          failureCategory: tool.failureCategory ?? "agent",
        },
      });
    }
    if (
      previousPost?.failed &&
      previousPost.resultFingerprint &&
      tool.resultFingerprint &&
      previousPost.resultFingerprint !== tool.resultFingerprint
    ) {
      madeProgress = true;
    }
  } else if (tool.family === "write") {
    const changedFiles = [];
    for (const filePath of tool.filePaths) {
      const captured = recordFileHash(
        state,
        cwd,
        filePath,
        "after-write",
        now,
        hashScope,
      );
      const oscillated =
        captured && detectOscillation(state.files[captured.pathAlias]);
      if (captured && captured.previous !== captured.digest && !oscillated) {
        changedFiles.push(captured.pathAlias);
      }
      if (oscillated) {
        detected = incident({
          state,
          now,
          ruleId: "edit_revert_oscillation",
          severity: "high",
          category: "agent",
          confidence: "high",
          signature: captured.pathAlias,
          message: localized(
            state.locale,
            "같은 파일이 수정 전 상태로 되돌아왔습니다.",
            "The same file returned to its earlier content after an edit.",
          ),
          recommendation: localized(
            state.locale,
            "충돌하는 제약을 확인하고 다음 수정 전에 한 가지 방향을 선택하세요.",
            "Check for conflicting constraints and choose one direction before editing again.",
          ),
          evidence: {
            pathAlias: captured.pathAlias,
            pattern: "A-B-A",
          },
        });
      }
    }
    madeProgress = changedFiles.length > 0;
  } else if (
    tool.family === "shell" &&
    (tool.operation === "test" || tool.operation === "build")
  ) {
    madeProgress =
      Boolean(tool.resultFingerprint) &&
      tool.resultFingerprint !== previousPost?.resultFingerprint;
    state.verification = {
      lastSuccessfulAt: now,
      operation: tool.operation,
    };
  } else if (
    previousPost &&
    (previousPost.failed ||
      (previousPost.resultFingerprint &&
        tool.resultFingerprint &&
        previousPost.resultFingerprint !== tool.resultFingerprint))
  ) {
    // The same observation returning new information is progress even if files did not change.
    madeProgress = true;
  }

  if (madeProgress) {
    state.progressVersion += 1;
  }

  state.toolEvents.push({
    phase: "post",
    at: now,
    family: tool.family,
    operation: tool.operation,
    signature: tool.signature,
    resultFingerprint: tool.resultFingerprint,
    failed: tool.failed,
    interrupted: tool.interrupted,
    failureCategory: tool.failureCategory,
    madeProgress,
    progressVersion: state.progressVersion,
  });

  return detected;
}
