import fs from "node:fs";
import path from "node:path";

import { detectLocale, hash, normalizeWhitespace, unique } from "./utils.mjs";

const ACTION =
  /\b(add|build|change|create|delete|deploy|ensure|fix|implement|install|make|migrate|refactor|remove|rename|run|ship|update|validate|write)\b|구현|만들|고쳐|수정|추가|삭제|변경|배포|설치|실행|작성|리팩터|개선|보장/iu;
const FOLLOW_UP_PART =
  /\b(?:sounds good|go ahead|do it|ok(?:ay)?|yes|yep|sure|continue|please|now)\b|좋아|응|네|그래|진행해|계속해|시작해|바로|주세요|줘/giu;
const BROAD =
  /\b(everything|entire|overall|all of it|make it better|fix it|clean it up|improve everything|whatever you think)\b|전체적으로|전반적으로|알아서|좋게|싹|다 고쳐|다 개선|전체\s*(?:저장소|코드|프로젝트)|모든\s*(?:파일|코드|문제)/iu;
const SUCCESS =
  /\b(acceptance|done|expected|finish|must|pass(?:es|ing)?|should|success|works?|when)\b|완료|기대|통과|성공|되어야|되면|동작|결과/iu;
const VERIFY =
  /\b(build|check|e2e|lint|test|typecheck|verify|verification)\b|검증|확인|테스트|빌드|린트|타입체크/iu;
const STOP =
  /\b(budget|max(?:imum)?|no more than|stop|timeout|token limit|tries|attempts)\b|중단|예산|토큰|시간 제한|횟수|실패하면|반복하면|두 번|세 번/iu;
const LONG_RUNNING =
  /\b(autonomous|do not stop|don't stop|keep going|long[- ]running|overnight|until complete|all files|entire repo)\b|멈추지 마|끝날 때까지|계속해서|장시간|전체 저장소|모든 파일/iu;
const TARGET =
  /(?:^|\s)(?:\.{0,2}\/)?[\w@-]+(?:\/[\w@.-]+)+|[\w@-]+\.(?:[cm]?[jt]sx?|py|rb|rs|go|java|kt|swift|md|json|ya?ml|toml|sql|html|css)\b|`[^`]+`|#[0-9]+\b/iu;

const TEXT = {
  ko: {
    broad: "작업 범위가 지나치게 넓습니다.",
    target: "대상 파일·기능·오류 중 하나가 명확하지 않습니다.",
    success: "완료됐다고 판단할 기준이 없습니다.",
    verify: "결과를 검증할 방법이 없습니다.",
    stop: "장시간 작업의 중단 조건이나 예산이 없습니다.",
    conflict: "질문을 금지하면서 확인을 요구하는 상충 지시가 있습니다.",
  },
  en: {
    broad: "The requested scope is too broad.",
    target: "No specific file, feature, or error target is clear.",
    success: "There is no observable definition of done.",
    verify: "There is no stated way to verify the result.",
    stop: "The long-running task has no stop condition or budget.",
    conflict: "The prompt both forbids and requires clarification.",
  },
};

function issue(id, locale, severity, weight, recommendation) {
  return {
    id,
    category: "user_instruction",
    severity,
    weight,
    message: TEXT[locale][id],
    recommendation,
  };
}

export function inspectProject(cwd) {
  const result = {
    instructionFiles: [],
    verificationCommands: [],
  };

  if (!cwd || !fs.existsSync(cwd)) {
    return result;
  }

  for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
    if (fs.existsSync(path.join(cwd, filename))) {
      result.instructionFiles.push(filename);
    }
  }

  const packagePath = path.join(cwd, "package.json");
  if (fs.existsSync(packagePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
      const scripts = parsed?.scripts ?? {};
      for (const name of ["test", "typecheck", "lint", "build"]) {
        if (typeof scripts[name] === "string") {
          result.verificationCommands.push(`npm run ${name}`);
        }
      }
    } catch {
      // A malformed package file should not make the hook fail.
    }
  }

  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    result.verificationCommands.push("pytest");
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    result.verificationCommands.push("cargo test");
  }
  if (fs.existsSync(path.join(cwd, "go.mod"))) {
    result.verificationCommands.push("go test ./...");
  }

  result.verificationCommands = unique(result.verificationCommands).slice(0, 3);
  return result;
}

export function buildSuggestedPrompt(prompt, evaluation) {
  const locale = evaluation.locale;
  const verification =
    evaluation.project.verificationCommands[0] ??
    (locale === "ko" ? "[검증 명령 또는 확인 방법]" : "[verification command or check]");

  if (locale === "ko") {
    return [
      `작업: ${normalizeWhitespace(prompt)}`,
      "범위: [대상 파일·기능과 제외할 범위]",
      "완료 조건: [사용자가 확인할 수 있는 결과]",
      `검증: ${verification}`,
      "중단 조건: 같은 실패가 2회 반복되면 원인을 보고하고 중단",
    ].join("\n");
  }

  return [
    `Task: ${normalizeWhitespace(prompt)}`,
    "Scope: [target files/features and explicit exclusions]",
    "Done when: [observable acceptance criteria]",
    `Verify with: ${verification}`,
    "Stop when: report and stop after the same failure repeats twice",
  ].join("\n");
}

export function evaluatePrompt(prompt, options = {}) {
  const normalized = normalizeWhitespace(prompt);
  const promptHash = hash(normalized, options.hashScope ?? null);
  const locale = detectLocale(normalized);
  const project = options.project ?? inspectProject(options.cwd);
  const wordCount = normalized.split(/\s+/u).filter(Boolean).length;
  const followUpRemainder = normalized
    .replace(FOLLOW_UP_PART, "")
    .replace(/[.!~,，。！？?\s]/gu, "");
  const isFollowUp = followUpRemainder.length === 0 && wordCount <= 12;
  const isSlashCommand = /^[#/]/u.test(normalized);
  const isAction = ACTION.test(normalized);
  const isBroad = BROAD.test(normalized);
  const isLongRunning = LONG_RUNNING.test(normalized);
  const isComplex =
    isBroad ||
    isLongRunning ||
    wordCount >= 14 ||
    (normalized.match(/\b(and|then|also|after)\b|그리고|그다음|또한|동시에/giu)?.length ?? 0) >= 2;
  const issues = [];

  if (!normalized || isFollowUp || isSlashCommand || !isAction) {
    return {
      promptHash,
      locale,
      score: 100,
      severity: "none",
      shouldWarn: false,
      isAction,
      isFollowUp,
      issues,
      project,
      suggestedPrompt: normalized,
    };
  }

  if (isBroad) {
    issues.push(
      issue(
        "broad",
        locale,
        "high",
        30,
        locale === "ko"
          ? "수정할 기능과 건드리지 않을 범위를 함께 지정하세요."
          : "Name the feature to change and what must remain untouched.",
      ),
    );
  }

  const hasTarget =
    TARGET.test(normalized) ||
    /\b(error|exception|endpoint|page|screen|component|function|class|API|database|schema|test)\b|오류|에러|페이지|화면|컴포넌트|함수|클래스|데이터베이스|스키마|테스트/iu.test(
      normalized,
    );
  if (!hasTarget && (wordCount < 10 || isComplex)) {
    issues.push(
      issue(
        "target",
        locale,
        "medium",
        20,
        locale === "ko"
          ? "파일 경로, 기능 이름 또는 실제 오류를 추가하세요."
          : "Add a file path, feature name, or concrete error.",
      ),
    );
  }

  if (isComplex && !SUCCESS.test(normalized)) {
    issues.push(
      issue(
        "success",
        locale,
        "medium",
        15,
        locale === "ko"
          ? "완료 후 보여야 할 동작이나 산출물을 적으세요."
          : "State the behavior or artifact that proves completion.",
      ),
    );
  }

  if (isComplex && !VERIFY.test(normalized)) {
    issues.push(
      issue(
        "verify",
        locale,
        "medium",
        15,
        locale === "ko"
          ? "테스트·빌드·수동 확인 중 하나를 지정하세요."
          : "Name a test, build, or manual verification step.",
      ),
    );
  }

  if (isLongRunning && !STOP.test(normalized)) {
    issues.push(
      issue(
        "stop",
        locale,
        "high",
        20,
        locale === "ko"
          ? "반복 실패 횟수, 시간 또는 토큰 한도를 추가하세요."
          : "Add a repeated-failure, time, or token limit.",
      ),
    );
  }

  const forbidsQuestions = /\b(do not ask|don't ask|no questions)\b|질문하지|묻지 마/iu.test(
    normalized,
  );
  const requiresQuestions = /\b(ask me|confirm with me|clarify)\b|물어봐|확인해줘|질문해/iu.test(
    normalized,
  );
  if (forbidsQuestions && requiresQuestions) {
    issues.push(
      issue(
        "conflict",
        locale,
        "high",
        30,
        locale === "ko"
          ? "질문 허용 여부를 하나로 정하세요."
          : "Choose one clarification policy.",
      ),
    );
  }

  const score = Math.max(
    0,
    100 - issues.reduce((total, current) => total + current.weight, 0),
  );
  const severity = issues.some((current) => current.severity === "high")
    ? "high"
    : issues.length
      ? "medium"
      : "none";
  const evaluation = {
    promptHash,
    locale,
    score,
    severity,
    shouldWarn: score < 80 || severity === "high",
    isAction,
    isFollowUp,
    issues,
    project,
  };

  return {
    ...evaluation,
    suggestedPrompt: buildSuggestedPrompt(normalized, evaluation),
  };
}
