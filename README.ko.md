# AWF — Agent Waste Firewall

[English](README.md)

AWF는 Codex와 Claude Code가 일하는 동안 옆에서 켜 두는 로컬 실시간 감시 도구를
목표로 합니다.
이 문서는 한국어 개요이며, 최신 기준 문서는 영문 [README.md](README.md)입니다.

단순한 사용량 대시보드가 아니라 세 가지를 작업 도중에 판단합니다.

1. 사용자의 요청에 범위·완료 기준·검증·중단 조건이 있는가?
2. 에이전트가 저장소 변화 없이 같은 읽기·테스트·실패·대기를 반복하는가?
3. 관찰된 낭비 원인이 사용자 지시, 에이전트, 실행 환경, 연결 도구 중 어디에 가까운가?

현재 `0.1.0`은 연구용 알파입니다. 실시간 훅, 프롬프트 점검, 반복 차단기, 상시
`LiveEventV1` 의미 이벤트 저장소, 원문 비저장 녹화, 익명 의미 재생, 로컬 대시보드가
동작합니다. 훅에는 정확한 토큰 사용량이 없으므로 아직 “몇 토큰을 절약했다”고 주장하지
않고, 절감 후보 호출 수와 감지 시점을 보여줍니다.
실제 훅 실행 파일은 Codex·Claude 형식의 합성 이벤트로 검증했지만, 각 프로그램에 설치한
상태의 승인·업그레이드·제거 검증은 아직 남아 있습니다.
대시보드는 별도 녹화 없이 상시 `LiveEventV1` 저장소를 기본으로 읽습니다. 완성된 신규
의미 이벤트만 증분 검사하고, 30초마다 제한된 현재 세대 전체를 다시 검사합니다. 세대
교체·재연결 때는 화면 상태를 원자적으로 초기화하며, 같은 작업공간의 여러 가명 세션도
진행 상태를 섞지 않습니다. 쓰기 경쟁은 `지연`, 손상은 빨간색 `검증 오류`로 구분하고
마지막 정상 상태만 유지합니다. `dashboard <trace-id>`로 명시적 과거 trace도 볼 수
있습니다.

## 현재 감지하는 것

- 너무 넓거나 완료·검증·중단 조건이 빠진 요청
- 진행 없이 반복되는 동일 도구 호출
- 같은 파일·검색 범위의 재확인
- 동일한 실패 결과 뒤의 재시도
- 결과 변화가 없는 상태 확인·대기
- 파일 상태가 `A → B → A`로 되돌아가는 편집 진동
- 동일한 고비용 테스트·빌드·출시 검증의 두 번째 실행

경고에는 항상 관찰 근거와 다음 행동을 함께 표시합니다. `block` 모드에서도 확신도가 높은
실행 전 반복만 막으며, 작업 종료를 자동으로 다시 깨우지 않습니다.

## 실시간 앱 사용 흐름

Node.js 18 이상이 필요합니다.

```bash
npm test
node bin/agent-waste-firewall.mjs doctor
```

플러그인이 실행되면 지원되는 모든 훅은 별도의 녹화 명령 없이도 제한된
`LiveEventV1` 저장소에 `best-effort` 방식으로 의미 이벤트를 남깁니다. 로컬
대시보드는 바로 열 수 있으며 명시적 녹화가 필요하지 않습니다.

```bash
node bin/agent-waste-firewall.mjs dashboard
```

출력된 `127.0.0.1` 주소를 브라우저에서 엽니다. 이 주소에는 무작위 로컬 접근 토큰이
포함됩니다. 그다음 같은 저장소에서 이 플러그인을 불러온 Codex 또는 Claude Code를
사용합니다. 아직 이벤트가 없는 정상 저장소는 연결된 대기 상태로 표시됩니다.

`축소`를 누르면 눈이 보이는 돋보기 감시 표시만 남고, 표시를 누르면 전체 대시보드가
다시 열립니다. 상태는 녹색 → 노란색 → 빨간색으로 바뀌며, 높은 심각도가 반복되면 축소
화면 전체가 짙은 빨간색으로 전환됩니다. 같은 상태를 브라우저 탭 제목과 파비콘에도
표시합니다. 브라우저 창은 운영체제에서 최소화하면 화면 위에 남을 수 없으므로, 실제
메뉴 막대·트레이 상시 표시는 후속 데스크톱 셸에서 이 의미 상태를 그대로 재사용합니다.

- `observe`: 감지만 기록하고 에이전트 작업에는 개입하지 않음
- `warn`: 감지 내용을 사용자 화면과 에이전트 문맥에 짧게 전달
- `block`: 확신도 높은 무진행 반복을 실행 전에 차단

첫 실전 데이터 수집은 반드시 `observe`로 시작하는 것을 권장합니다.

감사·export·재생할 연구용 trace만 별도로 선택해 녹화합니다.

```bash
node bin/agent-waste-firewall.mjs record start \
  --workspace /절대/경로/프로젝트 \
  --label first-pilot \
  --mode observe

# 정한 종료선까지 Codex 또는 Claude Code 작업을 진행합니다.
node bin/agent-waste-firewall.mjs record stop
node bin/agent-waste-firewall.mjs trace list
node bin/agent-waste-firewall.mjs trace audit <trace-id>
node bin/agent-waste-firewall.mjs dashboard <trace-id>
node bin/agent-waste-firewall.mjs trace export <trace-id> \
  --output ./public-semantic-trace.jsonl
node bin/agent-waste-firewall.mjs replay ./public-semantic-trace.jsonl \
  --mode warn
```

## 프라이버시

원문 훅 JSON을 저장한 뒤 마스킹하지 않습니다. 훅을 받은 메모리 안에서 즉시 의미 이벤트로
변환하고, 허용된 필드만 저장합니다.

로컬 탐지 상태에도 작업공간 이름, 파일명·경로, provider 도구명은 남기지 않습니다.
프롬프트·호출·결과·파일·작업공간은 세션 범위의 키 기반 별칭으로만 연결합니다.

상시 `LiveEventV1` 저장소에는 허용된 열거형, 제한된 숫자·시간값, 규칙·문제 ID와
`session_<HMAC>` 별칭만 들어갑니다. 원문, 경로, 파일명, 벽시계 시각, provider 원본 ID는
허용되지 않습니다. 세대마다 새로운 256비트 HMAC 키를 사용하고, 이벤트 4,096개 또는
8 MiB의 고정 상한에 도달하면 이전 세대와 키를 삭제하고 교체합니다. 24시간 제한은 다음
훅 발행·읽기·`doctor` 실행 때 적용되고, 대시보드가 열려 있으면 1초 주기 유지보수로
만료 데이터를 물리적으로 제거합니다. 아무 프로세스도 실행되지 않는 동안에는 정확히
만료 시각에 파일을 지울 수 없습니다. 설정으로 각 제한을 더 줄일 수만 있습니다. 이
저장소는 짧게 유지되는 로컬 화면 전달용이며 공개 export 대상이 아닙니다.

공개 가능한 trace에는 다음만 들어갑니다.

- `prompt`, `tool_pre`, `tool_post`, `stop` 이벤트 종류
- 도구군과 `test`, `build`, `verify` 같은 작업 분류
- 성공·실패·중단, 진행 여부, 상대 경과시간
- 규칙 ID, 심각도, 원인 분류
- 녹화 안에서만 같은 대상을 알아볼 수 있는 HMAC 별칭

다음은 저장하지 않습니다.

- 원문 프롬프트와 추천 프롬프트
- 명령어·인자·환경변수
- stdout·stderr·오류 메시지
- 절대·상대 경로와 파일명
- 소스 코드와 URL, Git remote, 이메일
- 원본 세션·turn·tool ID와 모델명

녹화마다 새로운 256비트 HMAC 키를 만들고 `record stop` 때 삭제합니다. export 전에 닫힌
스키마와 경로·URL·이메일·비밀키 패턴을 다시 검사합니다. 그래도 독특한 작업 순서만으로
프로젝트가 추정될 수 있으므로 “완전 익명”보다는 “강하게 최소화된 가명 데이터”가 정확한
표현입니다.

상시 저장소와 명시적 trace는 수명과 용도가 다릅니다. 전자는 화면 연결을 위한 제한된
운영 데이터이고, 후자만 사용자가 `record start`로 선택하여 감사·export·재생할 수
있습니다. `agent-waste-firewall purge --all`은 상시 저장소도 제거합니다.

## 플랫폼 연결

- Claude Code: 체크아웃을 `claude --plugin-dir /absolute/path/to/agent-waste-firewall`로
  불러올 수 있습니다.
- Codex: 로컬 마켓플레이스에서 플러그인을 연결한 뒤 훅을 검토하고 신뢰해야 합니다.

현재 버전은 전역 설정을 자동으로 수정하지 않습니다. Codex와 Claude의 훅 형식 차이는 별도
manifest로 처리하며 탐지 코어와 대시보드는 공유합니다.

## 한계

- 에이전트의 숨은 사고 과정을 읽지 않습니다.
- Codex의 hosted tool 등 일부 경로는 로컬 훅이 오지 않을 수 있습니다.
- 정확한 토큰·비용 수치는 후속 사용량 어댑터가 필요합니다.
- 프롬프트 코치는 결정론적 휴리스틱이며 좋은 요청을 증명하지 않습니다.
- 훅은 안전장치이지 자격 증명이나 운영 시스템을 보호하는 완전한 보안 경계가 아닙니다.
- 저장소가 바쁘거나 사용할 수 없으면 의미 이벤트가 누락될 수 있습니다. 확인 가능한
  순서 공백과 drop 표시는 `불완전한 관측`으로 보여주지만, 저장장치 자체가 실패하면 그
  표시도 기록하지 못할 수 있습니다.

영문 문서는 [README.md](README.md), 코어 설계는
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), macOS 제품 구조는
[docs/MACOS-ARCHITECTURE.md](docs/MACOS-ARCHITECTURE.md), 현재 구현 상태는
[docs/MACOS-IMPLEMENTATION.md](docs/MACOS-IMPLEMENTATION.md), 단계별 개발 가이드는
[docs/DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md), GitHub 경쟁·재사용 조사는
[docs/GITHUB-BENCHMARK-2026-07-29.md](docs/GITHUB-BENCHMARK-2026-07-29.md), 평가 기준은
[docs/EVALUATION.md](docs/EVALUATION.md), 최신 실제 검증 결과는
[docs/VALIDATION-REPORT-2026-07-29.md](docs/VALIDATION-REPORT-2026-07-29.md)를 참고하세요.

Apache-2.0 라이선스입니다.
