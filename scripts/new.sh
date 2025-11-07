#!/usr/bin/env bash
set -euo pipefail

# ==== 설정 ====
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-9222}"
POLL_MS="${POLL_MS:-300}"     # 폴링 간격(ms)
MAX_WAIT_MS="${MAX_WAIT_MS:-15000}"  # 최대 대기(ms)
FILTER_TITLE="${FILTER_TITLE:-}"     # 제목에 이 문자열이 포함된 타겟만 선택(옵션)
FILTER_URL_SUBSTR="${FILTER_URL_SUBSTR:-}" # URL 부분 문자열 필터(옵션)

# ==== 유틸 ====
sleep_ms() { perl -e "select(undef,undef,undef,$1/1000)"; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

open_url() {
  local url="$1"
  # macOS
  if have_cmd open; then open "$url" >/dev/null 2>&1 && return 0; fi
  # Linux
  if have_cmd xdg-open; then xdg-open "$url" >/dev/null 2>&1 && return 0; fi
  # Windows(Git Bash)
  if [[ -n "${COMSPEC:-}" ]]; then cmd.exe /d /s /c start "" "$url" >/dev/null 2>&1 && return 0; fi
  echo "URL을 자동으로 열 수 없습니다. 수동으로 여세요: $url" >&2
  return 1
}

to_devtools_url() {
  # 입력: webSocketDebuggerUrl (예: ws://127.0.0.1:9222/devtools/page/<id>)
  local ws="$1"
  ws="${ws#ws://}"   # ws:// 제거
  printf 'devtools://devtools/bundled/inspector.html?ws=%s' "$ws"
}

pick_ws_url_with_jq() {
  # jq 사용: /json -> 없으면 /json/list
  local json
  if ! json="$(curl -fsS "http://$HOST:$PORT/json" 2>/dev/null)" || [[ "$json" = "[]" ]]; then
    json="$(curl -fsS "http://$HOST:$PORT/json/list" 2>/dev/null || echo '[]')"
  fi
  # type=page만, 필터가 있으면 적용
  echo "$json" | jq -r --arg t "$FILTER_TITLE" --arg u "$FILTER_URL_SUBSTR" '
    map(select(.type=="page"))
    | ( if ($t|length)>0 then map(select(.title|tostring|contains($t))) else . end )
    | ( if ($u|length)>0 then map(select(.url|tostring|contains($u))) else . end )
    | .[0].webSocketDebuggerUrl // empty
  '
}

pick_ws_url_with_sed() {
  # jq가 없을 때 매우 단순 파서(가장 첫 page 항목의 webSocketDebuggerUrl만)
  # 필터 미지원(필요하면 jq 설치 권장)
  local body
  body="$(curl -fsS "http://$HOST:$PORT/json" 2>/dev/null || true)"
  [[ -z "$body" || "$body" = "[]" ]] && body="$(curl -fsS "http://$HOST:$PORT/json/list" 2>/dev/null || true)"
  echo "$body" \
    | tr -d '\n' \
    | sed -n 's/.*"type":"page".*?"webSocketDebuggerUrl":"\([^"]\+\)".*/\1/p' \
    | head -n1
}

pick_ws_url() {
  if have_cmd jq; then
    pick_ws_url_with_jq
  else
    pick_ws_url_with_sed
  fi
}

# ==== 메인 ====
echo ">> DevTools 자동 오픈: http://$HOST:$PORT/json(list) 에서 타겟 대기 중..."
elapsed=0
wsurl=""

while (( elapsed < MAX_WAIT_MS )); do
  # 연결 테스트(ECONNREFUSED 방지)
  if curl -fsS "http://$HOST:$PORT/json/version" >/dev/null 2>&1; then
    wsurl="$(pick_ws_url || true)"
    if [[ -n "$wsurl" ]]; then
      devtools_url="$(to_devtools_url "$wsurl")"
      echo ">> 대상 발견. DevTools 오픈: $devtools_url"
      open_url "$devtools_url" || true
      exit 0
    fi
  fi
  sleep_ms "$POLL_MS"
  (( elapsed += POLL_MS ))
done

echo "!! 타겟을 찾지 못했습니다. 포워딩/소켓/앱 상태를 확인하세요."
exit 1
