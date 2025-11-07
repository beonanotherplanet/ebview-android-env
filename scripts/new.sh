#!/usr/bin/env bash

#!/usr/bin/env bash
set -euo pipefail

# --- 설정 (Windows 전용) ---
PORT="${PORT:-9222}"          # 이미 adb forward 된 포트
FILTER="${FILTER:-}"          # 선택: 탭 URL에 포함될 문자열(없으면 첫번째 page)

command -v powershell.exe >/dev/null 2>&1 || {
  echo "[x] powershell.exe를 찾을 수 없습니다 (Windows PowerShell 필요)"; exit 1;
}

# PowerShell로 /json/list 파싱 → DevTools URL 산출
FINAL_URL="$(
  powershell.exe -NoProfile -Command "
    \$ErrorActionPreference = 'Stop'
    \$url  = 'http://localhost:${PORT}/json/list'
    \$json = (Invoke-WebRequest -UseBasicParsing -Uri \$url).Content
    \$items = \$json | ConvertFrom-Json

    # type=='page' 필터
    \$pages = \$items | Where-Object { \$_.type -eq 'page' }

    # URL 부분 필터(FILTER 환경변수)
    \$filter = [Environment]::GetEnvironmentVariable('FILTER','Process')
    if ([string]::IsNullOrEmpty(\$filter) -eq \$false) {
      \$pages = \$pages | Where-Object { \$_.url -like ('*' + \$filter + '*') }
    }

    if (-not \$pages) { exit 2 }

    \$first = \$pages | Select-Object -First 1

    \$path = \$first.devtoolsFrontendUrlCompat
    if (-not \$path -or [string]::IsNullOrEmpty(\$path)) { \$path = \$first.devtoolsFrontendUrl }

    \$ws = \$first.webSocketDebuggerUrl

    if (\$path -and \$path.StartsWith('/devtools/')) {
      \$final = 'https://chrome-devtools-frontend.appspot.com' + \$path
    } elseif (\$ws) {
      # websocket 기반 fallback
      \$final = 'https://chrome-devtools-frontend.appspot.com/serve_file/@10.0.0/inspector.html?ws=' + \$ws
    } elseif (\$path) {
      # devtools:// 스킴일 수 있음 (크롬 주소창에 붙여넣어야 할 수도)
      \$final = \$path
    } else {
      exit 3
    }

    Write-Output \$final
  " | tr -d '\r'
)"

if [[ -z "${FINAL_URL:-}" ]]; then
  echo "[x] DevTools URL 추출 실패"; exit 1
fi

echo "[i] Open DevTools: $FINAL_URL"
# 윈도우 기본 브라우저로 열기
cmd.exe /C start "" "$FINAL_URL" >/dev/null 2>&1 || {
  echo "[x] 브라우저 열기 실패. URL 수동으로 열어주세요:"
  echo "$FINAL_URL"
  exit 1
}





set -euo pipefail

#!/usr/bin/env bash
set -euo pipefail

# --- 설정 (윈도우 전용) ---
PORT="${PORT:-9222}"               # 이미 포워딩된 포트
FILTER="${FILTER:-}"               # 선택: 탭 URL에 포함될 문자열(없으면 첫 번째 page)

JSON_URL="http://localhost:${PORT}/json/list"

# 필수 도구 확인
command -v curl >/dev/null 2>&1 || { echo "[x] curl 필요"; exit 1; }
command -v jq   >/dev/null 2>&1 || { echo "[x] jq 필요"; exit 1; }

# JSON 한 번만 가져오기
JSON="$(curl -sf "$JSON_URL")"

# jq 셀렉터: type=="page" + (선택) URL 필터
JQ_BASE='.[] | select(.type=="page")'
if [[ -n "$FILTER" ]]; then
  JQ_BASE="${JQ_BASE} | select(.url | tostring | contains(\"${FILTER}\"))"
fi

# 1순위: devtoolsFrontendUrlCompat/ devtoolsFrontendUrl (경로가 /devtools/... 이면 appspot 프론트엔드로 연다)
PATH_PART="$(jq -r "${JQ_BASE} | (.devtoolsFrontendUrlCompat // .devtoolsFrontendUrl // empty)" <<<"$JSON" | head -n1)"

# 2순위: webSocketDebuggerUrl 로 inspector.html 구성
WS_URL="$(jq -r "${JQ_BASE} | .webSocketDebuggerUrl // empty" <<<"$JSON" | head -n1)"

if [[ -n "$PATH_PART" && "$PATH_PART" == /devtools/* ]]; then
  FINAL_URL="https://chrome-devtools-frontend.appspot.com${PATH_PART}"
elif [[ -n "$WS_URL" ]]; then
  FINAL_URL="https://chrome-devtools-frontend.appspot.com/serve_file/@10.0.0/inspector.html?ws=${WS_URL}"
elif [[ -n "$PATH_PART" ]]; then
  # devtools:// 로 시작하는 경우가 있을 수 있으나, Windows에서 직접 열기 호환성이 떨어져서 안내만 출력
  FINAL_URL="$PATH_PART"
else
  echo "[x] DevTools 대상 탭을 찾지 못했습니다."; exit 1
fi

echo "[i] Open DevTools: $FINAL_URL"
# 윈도우 전용 오픈 (기본 브라우저로 열림)
cmd.exe /C start "" "$FINAL_URL" >/dev/null 2>&1 || {
  echo "[x] 브라우저 열기 실패. URL 수동으로 열어주세요:"
  echo "$FINAL_URL"
  exit 1
}






ws='ws://127.0.0.1:9222/devtools/page/<id>'; url="devtools://devtools/bundled/inspector.html?ws=${ws#ws://}"; (command -v open>/dev/null&&open "$url")||(command -v xdg-open>/dev/null&&xdg-open "$url")||([ -n "${COMSPEC:-}" ]&&cmd.exe /d /s /c start "" "$url")||echo "$url"





#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-9222}"
POLL_MS="${POLL_MS:-300}"
MAX_WAIT_MS="${MAX_WAIT_MS:-15000}"
FILTER_TITLE="${FILTER_TITLE:-}"
FILTER_URL_SUBSTR="${FILTER_URL_SUBSTR:-}"

have_cmd() { command -v "$1" >/dev/null 2>&1; }

open_url() {
  local url="$1"
  if have_cmd open; then open "$url" >/dev/null 2>&1 && return 0; fi
  if have_cmd xdg-open; then xdg-open "$url" >/dev/null 2>&1 && return 0; fi
  if [[ -n "${COMSPEC:-}" ]]; then cmd.exe /d /s /c start "" "$url" >/dev/null 2>&1 && return 0; fi
  echo "URL을 자동으로 열 수 없습니다. 수동으로 여세요: $url" >&2
  return 1
}

to_devtools_url() {
  local ws="$1"
  ws="${ws#ws://}"
  printf 'devtools://devtools/bundled/inspector.html?ws=%s' "$ws"
}

pick_ws_url_with_jq() {
  local json
  if ! json="$(curl -fsS "http://$HOST:$PORT/json" 2>/dev/null)" || [[ "$json" = "[]" ]]; then
    json="$(curl -fsS "http://$HOST:$PORT/json/list" 2>/dev/null || echo '[]')"
  fi
  echo "$json" | jq -r --arg t "$FILTER_TITLE" --arg u "$FILTER_URL_SUBSTR" '
    map(select(.type=="page"))
    | ( if ($t|length)>0 then map(select(.title|tostring|contains($t))) else . end )
    | ( if ($u|length)>0 then map(select(.url|tostring|contains($u))) else . end )
    | .[0].webSocketDebuggerUrl // empty
  '
}

pick_ws_url_with_sed() {
  local body
  body="$(curl -fsS "http://$HOST:$PORT/json" 2>/dev/null || true)"
  [[ -z "$body" || "$body" = "[]" ]] && body="$(curl -fsS "http://$HOST:$PORT/json/list" 2>/dev/null || true)"
  echo "$body" \
    | tr -d '\n' \
    | sed -n 's/.*"type":"page".*?"webSocketDebuggerUrl":"\([^"]\+\)".*/\1/p' \
    | head -n1
}

pick_ws_url() {
  if have_cmd jq; then pick_ws_url_with_jq; else pick_ws_url_with_sed; fi
}

echo ">> DevTools 자동 오픈: http://$HOST:$PORT/json(list) 타겟 대기 중..."
elapsed=0
wsurl=""
interval_sec="$(printf '%.3f' "$(awk "BEGIN{print $POLL_MS/1000}" 2>/dev/null || echo "0.300")")"

while (( elapsed < MAX_WAIT_MS )); do
  if curl -fsS "http://$HOST:$PORT/json/version" >/dev/null 2>&1; then
    wsurl="$(pick_ws_url || true)"
    if [[ -n "$wsurl" ]]; then
      devtools_url="$(to_devtools_url "$wsurl")"
      echo ">> 대상 발견. DevTools 오픈: $devtools_url"
      open_url "$devtools_url" || true
      exit 0
    fi
  fi
  sleep "$interval_sec"                                # ← Perl 제거, 순수 bash
  (( elapsed += POLL_MS ))
done

echo "!! 타겟을 찾지 못했습니다. 포워딩/소켓/앱 상태를 확인하세요."
exit 1






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
