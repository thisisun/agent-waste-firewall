# AWF — Agent Waste Firewall

[영문 README](README.md)

AWF는 Codex와 Claude Code가 일하는 동안 옆에서 켜 두는 로컬 실시간 감시 도구를
목표로 합니다.
이 문서는 한국어 개요이며, 최신 기준 문서는 영문 [README.md](README.md)입니다.

단순한 사용량 대시보드가 아니라 세 가지를 작업 도중에 판단합니다.

1. 사용자의 요청에 범위·완료 기준·검증·중단 조건이 있는가?
2. 에이전트가 저장소 변화 없이 같은 읽기·테스트·실패·대기를 반복하는가?
3. 관찰된 낭비 원인이 사용자 지시, 에이전트, 실행 환경, 연결 도구 중 어디에 가까운가?

현재 `0.1.0`은 연구용 알파입니다. 실시간 훅, 프롬프트 점검, 반복 차단기, 상시
`LiveEventV1` 의미 이벤트 저장소, 원문 비저장 녹화, 원문 없는 가명 의미 재생, 로컬
대시보드가
동작합니다. 훅에는 정확한 토큰 사용량이 없으므로 아직 “몇 토큰을 절약했다”고 주장하지
않고, 절감 후보 호출 수와 감지 시점을 보여줍니다.
SwiftUI/AppKit 메뉴 막대, 로컬 `WKWebView`, 투명한 플로팅 감시 패널을 포함한 macOS
개발자 미리보기도 소스에 들어 있습니다. Xcode 앱은 hardened-runtime Swift
`awf-hook`을 `Contents/Helpers`에 포함하며, 네이티브 연동 관리 화면과
설치·업그레이드·복구·rollback·보수적 제거 코어도 구현됐습니다. 릴리스 입력은
아키텍처별 Node.js `v24.18.0`으로 고정되며 공식 archive, 실행 파일, 전체 라이선스,
중첩 서명, 정확한 버전과 서명 후 해시를 검증합니다. 다만 저장소에는 생성된 Node
바이너리를 커밋하지 않으므로 일반 소스 빌드에서는 설치 버튼이 안전하게 비활성화됩니다.
아직 Developer ID 서명·공증·배포 패키지는 없고, 개발자 미리보기 대시보드는 설치된
Node.js 18 이상을 사용합니다.
실제 훅 실행 파일은 Codex·Claude 형식의 합성 이벤트로 검증했고, 두 provider 모두
격리된 marketplace 추가·설치·목록·설치 launcher·개인정보 검증을 통과했습니다. 다만
사용자 소유 provider의 훅 신뢰·실시간 전달과 업그레이드·제거 검증은 아직 남아 있습니다.
provider manifest는 계속 plugin-root `/bin/sh -p` shim을 호출합니다. macOS shim은
provider root 환경으로 Codex 또는 Claude를 하나만 명확히 판별했을 때, 안전한 고정
사용자 경로
`~/Library/Application Support/io.github.thisisun.agent-waste-firewall/integration-v1/awf-hook`을
먼저 호출합니다. helper가 없거나 unsafe하거나 provider 판별이 ambiguous하면 기존 외부
Node 알파 경로를 유지합니다. helper가 호출된 뒤 activation이 잘못되면 fail-open하며
Node로 다시 시도하거나 두 번째 JSON을 붙이지 않습니다. 두 경로 모두 shim이 제어권을
얻은 뒤에는 상속 `PATH`를 검색하지
않습니다. 이 처리는 provider나 최초 interpreter/loader 시작 단계를 정리하지 못합니다.
Claude의 exec 형식은 별도의 명령 평가 shell을 추가하지 않지만 provider가 `/bin/sh`를
시작하는 경로는 신뢰 경계입니다. Codex는 여기에 provider가 상속한 `$SHELL -lc` 평가
단계가 추가되며, 이 경로도 AWF 경계 밖입니다. 자세한 근거는
[Codex command-runner source](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/command_runner.rs#L125-L164)를
참고하세요. 검사하지 못한 이벤트마다 원문 없는 고정 경고를 stderr에 출력하며, 이 사전
runtime 경고는 rate-limit하지 않습니다. native handoff와 설치 수명주기는 구현됐지만
Developer ID 서명·공증과 clean-machine provider 전달 검증이 끝났다는 뜻은 아닙니다.
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

고정 native helper가 선택되지 않을 때 사용하는 외부 runtime 알파 경로는 symlink runtime
후보를 의도적으로 거부합니다. Homebrew나 Volta의 symlink만 있으면 fail-open 되므로
provider를 실행할 때 `AWF_NODE_PATH`를 실제 절대 경로의 일반 Node 실행 파일로
지정하거나, NVM 버전 폴더의 일반 실행 파일을 사용해야 합니다.

```bash
npm test
node bin/agent-waste-firewall.mjs doctor
node bin/agent-waste-firewall.mjs integration status
```

`doctor`의 `engineReady`는 AWF 엔진·파일·Node.js·제한 저장소를 실행할 수 있다는 뜻입니다.
실제 Codex 또는 Claude Code 훅이 활동 중이라는 뜻은 아닙니다. 그래서 엔진은 정상이어도
`providerInstalled`와 `monitoringActive`는 별도로 표시됩니다. 일회성 CLI 검사는 보관된
이벤트를 현재 활동으로 승격하지 않으므로 플러그인이 있어도 `monitoringActive`는
`false`, `monitoring`은 `attention`일 수 있습니다. 자세한 provider 상태는 다음 닫힌
원문 비저장 계약으로 확인합니다.

```bash
node bin/agent-waste-firewall.mjs integration status --json
```

대시보드의 Codex·Claude Code 카드도 설치 상태와 감사된 활동을 구분합니다. 현재 활동은
대시보드 서버를 연 뒤 새로 도착한 의미 이벤트만 근거로 삼고 5분 뒤 만료됩니다. 시작 전에
저장된 이벤트와 명시적으로 연 과거 trace는 현재 활성 상태로 계산하지 않습니다.
읽기 전용 provider 하위 프로세스에는 실행 파일·로컬 설정 탐색에 필요한 닫힌 환경 목록만
전달하며 API 키와 관련 없는 프로세스 secret은 전달하지 않습니다. 실제 CLI와 대시보드는
Codex·Claude 검사를 동시에 실행합니다. 각 provider의 버전 확인과 플러그인 목록 확인은
하나의 3초 검사 예산을 공유하고, 시간 초과 시 대시보드를 붙잡지 않고 닫힌 `unknown`
상태로 정리합니다. 프로세스 시작과 그 밖의 CLI 작업 시간은 이 provider 검사 예산과
별개입니다.

플러그인을 불러온 뒤 실제 훅 전달을 읽기 전용으로 확인하려면 일반 터미널에서 다음 중
하나를 실행합니다.

```bash
node bin/agent-waste-firewall.mjs integration verify codex --timeout 60
node bin/agent-waste-firewall.mjs integration verify claude --timeout 60 --json
```

기다리는 동안 선택한 provider의 별도 대화에서 짧고 무해한 새 프롬프트를 제출합니다.
검증기는 시작 전에 남아 있던 이벤트를 무시하고, 시작 기준선 뒤에 도착한 해당 provider의
감사된 프롬프트 의미 이벤트 하나만 인정합니다. `observed`는 로컬 AWF 훅 경로가 그
이벤트를 만들었다는 근거입니다. `timed_out`은 제한 시간 안에 조건을 만족하는 이벤트가
없었다는 뜻일 뿐, provider나 훅이 고장 났다는 증명은 아닙니다. 결과에는 프롬프트,
명령어, 출력, transcript, 경로, provider CLI 원문이 들어가지 않습니다.

`--json`에서는 stdout에 최종 닫힌 결과 하나만 출력합니다. 기준선이 준비되면 stderr에
`AWF_READY provider=claude timeoutSeconds=60` 같은 고정 한 줄이 나오므로, 그 줄을 확인한
뒤 새 프롬프트를 보냅니다.

이 검사는 전달을 관찰하는 도구이지 provider 신원 증명은 아닙니다. 로컬 의미 이벤트를
쓴 프로세스의 신원을 암호학적으로 증명하지 않으며, Codex나 Claude Code를 설치·활성화·
실행·복구·설정하지도 않습니다. provider 상태 검사와 전달 검사는 서로 다른 읽기 전용
근거입니다.

provider CLI가 있는 개발자는 별도의 격리 설치·launcher 검증도 할 수 있습니다.

```bash
npm run acceptance:providers
# 또는 각각 실행
npm run acceptance:codex
npm run acceptance:claude
```

두 검증은 임시 provider 설정에서 마켓플레이스 추가, 설치, 목록·상세 확인, 설치된
launcher 실행, 닫힌 의미 이벤트, 원문 canary 비저장, 임시 파일 정리를 확인합니다.
Codex는 prompt/pre-tool/post-tool과 관찰 전용 `Stop`을, Claude는 여기에
`PostToolUseFailure`까지 검사합니다. 프롬프트·세션·turn·작업공간·tool ID·입력·출력의
앞뒤에 필드별 고유 표식을 넣고, 원문 일부만 저장되는 회귀도 검증 실패로 잡습니다.

이 검사는 사용자 전역 설정을 바꾸거나 Codex `/hooks` 신뢰를 승인하지 않으며, Claude의
`disableAllHooks`나 조직 정책을 우회하지 않습니다. 실제 provider가 훅을 전달했다는
주장도 하지 않습니다. 내부 launcher를 직접 실행하므로 provider 전달, 적대적인 최초
interpreter/loader 시작, Codex의 바깥 login shell도 검증하지 않습니다. 사용자 소유
실제 세션 전달은 별도의 읽기 전용 `integration verify`로 확인합니다.

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
메뉴 막대와 투명 `NSPanel`은 아래 macOS 개발자 미리보기에서 이 의미 상태를 그대로
재사용합니다.

### macOS 개발자 미리보기

macOS 13.5 이상과 Xcode가 필요합니다. Xcode 프로젝트는 GitHub 체크아웃에 들어 있습니다.
공개 npm 배포물은 이식 가능한 플러그인/CLI 패키지이며 `macos/`를 포함하지 않으므로,
아래 네이티브 명령은 GitHub 저장소를 복제한 뒤 실행해야 합니다. 현재 Xcode 프로젝트는
검토된 `bin/`, `src/`, `assets/` 폴더와 hardened Swift `awf-hook`을 앱에 포함하지만,
생성된 `awf-node`는 포함하지 않습니다. 따라서 연동 관리 화면은 봉인된 설치 파일을
사용할 수 없다고 표시하고 변경 버튼을 비활성화합니다. 대시보드는 시스템에 설치된
Node.js 18 이상을 사용할 수 있습니다. 서명하지 않은 소스 빌드는 다음과 같이 확인합니다.

```bash
AWF_DERIVED_DATA="${TMPDIR%/}/awf-derived-data"
xcodebuild \
  -project macos/AWF.xcodeproj \
  -scheme AWF \
  -configuration Debug \
  -destination 'platform=macOS' \
  -derivedDataPath "$AWF_DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  DEVELOPMENT_TEAM= \
  build
```

이 명령은 컴파일·번들 구성을 확인할 뿐 배포용 앱을 만들지 않습니다. helper는 향후
서명을 위한 hardened 설정으로 빌드되지만 현재 Developer ID 서명은 없습니다. 공증, DMG,
내장 Node 런타임은 아직 없습니다. 연동 UI와 로컬 수명주기 관리자는 들어 있지만,
서명된 런타임과 앱 서명으로 보호되는 해시가 없으면 fail-closed합니다. 실제 개발 실행은
`macos/AWF.xcodeproj`를 Xcode에서 열고 로컬 서명을 사용합니다. 네이티브 앱은 상속된
`PATH`를 검색하지 않고 절대 `AWF_NODE_PATH`, 제한된 Volta/NVM 위치, 고정 표준 위치만
검사한 뒤 Node 18 이상인지 시간 제한 probe로 확인합니다.

native activation은 정확히
`{"v":1,"releaseId":"rel_<32자리 소문자 hex>","workerProtocol":1}`과 마지막 줄바꿈만
허용합니다. 이 ID는 `integration-v1/versions/<releaseId>/awf-node`만 선택하며 manifest에
실행 경로를 저장하지 않습니다. helper는 원문 stdin을 읽거나 저장하지 않고 worker에
직접 연결하고, 닫힌 환경만 전달하며, child process group에 2.25초 deadline과 제한된
종료·강제 정리·reap을 적용합니다. 네이티브 관리자는 전체 번들 파일을 먼저 검증한 뒤
이 구조를 설치합니다. 같은 volume staging, 프로세스·프로세스 간 잠금, 해시 소유권 장부,
side-by-side 릴리스, 원자적 활성화, rollback 보존, 중단 뒤 stale 기록 복구와
잔여물 보존 제거를 적용합니다. 고정 Node 준비와 안쪽부터 서명하는 순서는
[macOS 런타임 릴리스 봉인 가이드](docs/MACOS-RUNTIME-RELEASE.md)를 참고하세요.

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

네이티브 미리보기도 원문 훅을 받지 않습니다. 제한된 `dashboard_ready`,
`DashboardStatusV1`, `ProviderIntegrationStatusV1` 계약만 Swift에서 검증하고, WebKit
데이터 저장소는 비영구 모드이며 정확한 토큰 포함 `127.0.0.1` 주소 이외의 이동을
거부합니다. 외부 Node를 실행해야 하므로 현재 미리보기는 App Sandbox를 사용하지 않으며,
공개 보안 강화 빌드로 간주하면 안 됩니다.

로컬 탐지 상태에도 작업공간 이름, 파일명·경로, provider 도구명은 남기지 않습니다.
프롬프트·호출·결과·파일·작업공간은 세션 범위의 키 기반 별칭으로만 연결합니다.
각 상태 파일은 최근 tool event 512개, incident 256개, 파일 별칭 512개, 별칭당 hash
8개를 넘지 않는 hard ceiling을 적용합니다.
훅의 상태 변경 경로에서는 세션 보존 기간을 확인하기 위한 디렉터리 scan을 전혀 하지
않습니다. 대시보드 프로세스나 macOS 앱 monitor가 실행 중일 때 별도의 best-effort
janitor가 30일이 지난 세션 상태를 점진적으로 정리합니다. 한 tick은 디렉터리 항목을
최대 64개만 확인하고 8 ms의 soft 작업 예산을 사용합니다. 단일 파일시스템 작업이 이
soft 예산을 넘을 수 있으므로 hard deadline을 뜻하지 않습니다. 디렉터리 cursor가
EOF에 도달했을 때만 다음 한 시간 marker를 기록합니다. monitor가 닫히거나 오류가 나면
완료 marker를 남기지 않고 cursor를 닫기 때문에, 다음 실행에서 sweep을 처음부터 다시
시작합니다. 이 경로는 세션 파일 내용을 읽지 않고 파일시스템 metadata만 사용하며,
경로나 항목 이름 없이 닫힌 상태와 숫자 counter만 반환합니다.

즉시 정리하려면 전체 scan을 실행하는 `agent-waste-firewall purge`를 사용하고, 비활성
세션 상태를 모두 지우려면 `agent-waste-firewall purge --all`을 사용하세요. 보존 기간은
`AGENT_WASTE_FIREWALL_RETENTION_DAYS`로 바꿀 수 있습니다. GUI·앱 monitor와 대시보드
프로세스가 모두 실행되지 않으면 자동 세션 정리는 다음 monitor 실행까지 지연됩니다.
janitor와 명시적 purge는 오래된 timestamp만으로 writer 종료를 단정하지 않고 모든 세션
lock을 활성 상태로 취급합니다. lock이 없는 고아 atomic-write 파일만 제거합니다. 공개
beta 전에는 무인 정리를 위한 OS 관리 trigger, 검증 가능한 고아 lock 복구,
lifecycle·작업량의 hard cap이 추가로 필요합니다.

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

- Codex: 마켓플레이스를 연결하고 AWF를 설치·활성화한 뒤 `/hooks`를 엽니다. AWF 명령을
  확인하고 현재 훅 설정의 정확한 hash를 명시적으로 신뢰한 다음
  `integration verify codex`를 실행합니다. 업그레이드로 훅이 바뀌면 hash가 달라져 다시
  검토해야 할 수 있습니다.
- Claude Code 마켓플레이스 설치:
  `claude plugin marketplace add thisisun/agent-waste-firewall`을 실행하고
  `claude plugin install agent-waste-firewall@agent-waste-firewall`로 설치한 뒤 활성 세션에서
  `/reload-plugins`를 실행합니다. Claude의 신뢰 경계는 플러그인을 불러오거나 설치할 때의
  source이며, `/hooks`는 읽기 전용 확인 화면이지 별도의 훅 승인 단계가 아닙니다.
- Claude Code 체크아웃: 새 세션을
  `claude --plugin-dir /absolute/path/to/agent-waste-firewall`로 시작합니다. 이 방식은 해당
  세션에서만 체크아웃을 신뢰하고 불러오며, 전역 설치를 만들지 않아 전역
  `claude plugin list`에 나타나지 않는 것이 정상입니다. 훅을 바꾼 뒤에는
  `/reload-plugins`를 실행합니다.

AWF는 provider의 신뢰 절차를 우회하지 않습니다. Codex는 정확한 훅 hash를 별도로
검토하고, Claude Code는 플러그인 source를 불러오거나 설치할 때 신뢰합니다. 현재 AWF
명령은 전역 provider 설정을 자동으로 수정하지 않습니다. 전역 설치, 활성화, 훅 검토와
신뢰는 사용자가 명시적으로 결정합니다. Codex와 Claude의 훅 형식 차이는 별도 manifest로
처리하며 탐지 코어와 대시보드는 공유합니다.

새 프롬프트가 관찰되지 않으면 플러그인 활성화 상태를 확인하고 provider를 reload하거나
다시 시작합니다. Codex는 `/hooks`에서 현재 hash가 다시 신뢰를 요구하는지 확인합니다.
Claude Code는 `/hooks`에서 실제 불러온 명령을 확인하고, `disableAllHooks` 또는 조직의
`allowManagedHooksOnly` 정책이 플러그인 훅을 제외하는지 확인합니다. 관리형 설정은
플러그인 파일이 있어도 로컬 훅 실행을 막을 수 있습니다.

이 저장소를 검증한 Mac의 셸 `PATH` 기준 읽기 전용 상태는 Codex `0.146.0`
`needs_install`, Claude Code `not_detected`입니다. 네이티브 supervisor의 닫힌 검색
경로는 안전한 사용자 로컬 위치의 Claude Code `2.1.207`도 찾아 `needs_install`로
표시합니다. 같은 Mac에서 Codex와 Claude의 격리 설치·launcher·프라이버시·정리 검증은
모두 통과했습니다. 하지만 사용자 소유 설정에서 훅을 검토·신뢰했거나 실제 provider
이벤트가 전달됐다는 뜻은 아닙니다.

## 한계

- 에이전트의 숨은 사고 과정을 읽지 않습니다.
- Codex의 hosted tool 등 일부 경로는 로컬 훅이 오지 않을 수 있습니다.
- provider 감지는 읽기 전용 근거입니다. 설치·활성화만으로 훅 전달을 증명하지 않으며,
  대시보드를 연 뒤 5분 안에 관찰한 새 provider 이벤트가 있어야 현재 활동으로 표시합니다.
- 정확한 토큰·비용 수치는 후속 사용량 어댑터가 필요합니다.
- 프롬프트 코치는 결정론적 휴리스틱이며 좋은 요청을 증명하지 않습니다.
- 훅은 안전장치이지 자격 증명이나 운영 시스템을 보호하는 완전한 보안 경계가 아닙니다.
- 저장소가 바쁘거나 사용할 수 없으면 의미 이벤트가 누락될 수 있습니다. 확인 가능한
  순서 공백과 drop 표시는 `불완전한 관측`으로 보여주지만, 저장장치 자체가 실패하면 그
  표시도 기록하지 못할 수 있습니다.
- macOS 앱은 hardened Swift helper를 포함하지만 서명하지 않은 소스 미리보기입니다.
  연동 수명주기와 UI는 구현됐지만 저장소에는 생성된 Node 바이너리가 없습니다. 소스
  미리보기 대시보드는 설치된 Node.js 18 이상에 의존합니다. Developer ID 서명, 공증,
  clean-machine provider 전달과 배포 패키지는 아직 완료되지 않았습니다.
- 검사한 Apple-silicon Mac에서 2026-07-30 current-head를 통제된 조건으로 다시 측정한
  결과, 측정한 모든 내부 훅 경로가 p95 100 ms 제품 목표 아래였습니다. 5회 warmup 뒤
  50개 표본을 세 번 측정했을 때 외부 launcher는 활성 trace 없이
  64.670/49.438/48.692 ms, 활성 trace에서 50.294/57.978/50.585 ms였습니다. 네이티브
  내부 경로는 각각 60.054/60.040/60.271 ms와 66.668/60.684/60.999 ms였습니다.
- 이 측정에는 내부 shell, 실제 worker, 상시 live spool이 포함되고, 네이티브 경로에는
  서명하지 않은 Debug helper와 현재 Node runtime의 임시 복제본도 포함됩니다. provider
  dispatch와 provider가 만드는 바깥 shell은 제외했고 runtime prewarm도 포함하지
  않았습니다. 따라서 더 넓은 지원 Mac 범위나 clean machine 성능까지 증명하지는
  않습니다. 이전 loaded-host 및 봉인 runtime 수치는 검증 보고서에 과거 변동 근거로
  남겨 두었습니다.
- macOS shim은 안전한 고정 사용자 helper를 우선 사용할 수 있지만, helper가 없거나
  unsafe하면 외부 Node 알파 경로를 유지합니다. helper 호출 뒤 activation 오류는
  fail-open하고 Node로 재시도하지 않습니다. provider가 시작하는 최초 interpreter/loader와
  Codex의 바깥 login shell은 신뢰 경계로 남습니다. 구현된 고정 runtime·원자적
  activation·복구·rollback은 Developer ID·공증 및 clean-machine 종단 검증이 더
  필요합니다.
- 관리자는 번들 runtime이 바깥 앱에 봉인된 해시와 일치하는지 확인하고, 설치된
  helper/runtime 바이트를 private ownership ledger와 대조합니다. 제한 시간 안에 Node
  버전과 V8 준비 상태를 검사한 뒤 staged runtime을 사전 실행합니다. 릴리스 finalizer는
  중첩 서명 무결성, hardened runtime, 정확히 하나의 entitlement를 별도로 검사하지만
  Developer ID 신원과 공증은 여전히 릴리스 gate입니다.
- x64 입력은 고정됐지만 Intel Mac 실행 검증은 아직 없습니다. 네이티브 UI 자동화,
  최소 지원 macOS 실행, Developer ID 서명, 공증, Gatekeeper, clean-machine 검증도
  완료되지 않았습니다. 공개 베타 전에는 원문 없는 고정 helper/worker protocol
  handshake와 실제 프로세스 강제 종료 기반 crash 복구 테스트도 추가해야 합니다.
  Windows provider 훅 실행은 현재 지원하지 않으며 배포된 훅 경로는 macOS/POSIX
  우선입니다.

영문 문서는 [README.md](README.md), 코어 설계는
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), macOS 제품 구조는
[docs/MACOS-ARCHITECTURE.md](docs/MACOS-ARCHITECTURE.md), 현재 구현 상태는
[docs/MACOS-IMPLEMENTATION.md](docs/MACOS-IMPLEMENTATION.md), 단계별 개발 가이드는
[docs/DEVELOPMENT-GUIDE.md](docs/DEVELOPMENT-GUIDE.md), 런타임 봉인 절차는
[docs/MACOS-RUNTIME-RELEASE.md](docs/MACOS-RUNTIME-RELEASE.md), GitHub 경쟁·재사용 조사는
[docs/GITHUB-BENCHMARK-2026-07-29.md](docs/GITHUB-BENCHMARK-2026-07-29.md), 평가 기준은
[docs/EVALUATION.md](docs/EVALUATION.md), 최신 실제 검증 결과는
[docs/VALIDATION-REPORT-2026-07-30.md](docs/VALIDATION-REPORT-2026-07-30.md)를 참고하세요.

Apache-2.0 라이선스입니다.
