# AWF protocol files

AWF protocol schemas describe closed semantic allowlists. They never permit raw prompts, tool inputs, tool outputs, transcript text, or source-file content.

## Helper/worker handshake v1

`helper-worker-handshake-v1.schema.json` defines the semantic object. The shipped `helper-worker-handshake-v1.json` file is also a transport marker and therefore has a stricter byte contract: compact UTF-8 JSON, keys ordered as `v`, `workerProtocol`, `runtime`, `runtimeMajor`, and exactly one trailing LF (`0x0a`). The native helper validates those exact bytes before reading or handing off provider stdin.

The native macOS path accepts only `--awf-worker-protocol 1 --awf-runtime-major 24` under Node 24. The portable launcher and CLI path accept only `--awf-portable-protocol 1` under Node 18 or newer. Zero arguments, unknown arguments, a protocol mismatch, or a native runtime-major mismatch fail open before stdin is read. The response is a fixed provider-visible `systemMessage`; no live or trace event is published.

## 한국어

스키마는 개인정보를 포함하지 않는 닫힌 의미 구조만 정의합니다. 네이티브 helper는 provider stdin을 읽거나 worker에 전달하기 전에 저장된 marker의 바이트, 프로토콜 인자, Node 24 runtime을 정확히 검증합니다. portable 경로는 명시적인 protocol 인자와 Node 18 이상만 허용하며, 불일치 시 입력을 읽거나 이벤트를 기록하지 않고 고정된 안내 메시지로 fail-open 합니다.
