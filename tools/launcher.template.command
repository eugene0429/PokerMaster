#!/bin/bash
#
# PokerMaster — 바탕화면 런처
#
# 이 파일을 직접 고치지 마세요. 바탕화면에 놓인 것은 사본입니다.
# tools/launcher.template.command 를 고친 뒤 `npm run launcher` 로 다시 까세요.
#
# 아래 ROOT 는 설치할 때 이 저장소의 절대경로로 채워집니다.

ROOT="__ROOT__"
export PORT="${PORT:-3000}"
# 링크 초대(공개 링크)로 켭니다. 터널이 안 열리면 서버가 알아서 같은 와이파이
# 모드로 뜹니다.
export SHARE=1
URL="http://localhost:$PORT"

printf '\033]0;PokerMaster\007'

# Finder 가 띄우는 셸은 로그인 셸이라 보통 PATH 가 살아 있지만, node 를 못 찾는
# 상태로 열리면 아무 설명 없이 실패하므로 흔한 설치 경로를 먼저 못 박아 둡니다.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  echo ""
  echo "  $1"
  echo ""
  read -r -p "  엔터를 누르면 창이 닫힙니다."
  exit 1
}

cd "$ROOT" 2>/dev/null || fail "PokerMaster 폴더를 찾지 못했습니다: $ROOT"
command -v node >/dev/null || fail "Node.js 가 필요합니다 — https://nodejs.org 에서 설치한 뒤 다시 실행하세요."

# 우리 서버가 이미 떠 있으면 두 번째를 띄우지 않습니다. 포트만 보고 판단하면
# 3000 번을 쓰는 남의 프로그램에 브라우저를 열어 주게 되므로 응답까지 확인합니다.
if curl -fsS --max-time 1 "$URL" 2>/dev/null | grep -q PokerMaster; then
  echo ""
  echo "  이미 실행 중입니다 — 브라우저만 엽니다."
  echo "  공개 링크가 안 보이면 켜져 있는 PokerMaster 창을 닫고 다시 눌러 주세요."
  open "$URL"
  exit 0
fi

# 우리가 아닌 무언가가 그 포트를 잡고 있으면 node 는 EADDRINUSE 한 줄만 남기고
# 죽습니다. 무슨 일인지 먼저 설명합니다.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "$PORT 번 포트를 다른 프로그램이 쓰고 있습니다. 그 프로그램을 끄거나, 터미널에서 PORT=3001 npm start 로 실행하세요."
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  처음 실행이라 준비가 필요합니다. 잠시만요…"
  npm install || fail "준비에 실패했습니다. 터미널에서 npm install 을 직접 실행해 보세요."
fi

# 링크 초대에는 cloudflared 가 있어야 합니다. 없으면 여기서 깔 기회를 줍니다 —
# 그냥 넘어가면 서버가 경고 한 줄과 함께 같은 와이파이 모드로 뜹니다.
if ! command -v cloudflared >/dev/null; then
  echo ""
  echo "  링크 초대에는 cloudflared 가 필요합니다 (처음 한 번만)."
  if command -v brew >/dev/null; then
    read -r -p "  지금 설치할까요? [Y/n] " answer
    if [[ ! "$answer" =~ ^[Nn] ]]; then
      brew install cloudflared || echo "  설치에 실패했습니다. 같은 와이파이 모드로 켭니다."
    fi
  else
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    echo "  에서 설치한 뒤 다시 실행하세요. 지금은 같은 와이파이 모드로 켭니다."
  fi
fi

# 서버가 실제로 응답할 때까지 기다렸다가 연다 — 너무 일찍 열면 빈 페이지가 뜹니다.
(
  # 터널이 열린 뒤에야 서버가 뜨므로 넉넉히 기다립니다.
  for _ in $(seq 1 120); do
    curl -fsS -o /dev/null --max-time 1 "$URL" 2>/dev/null && { open "$URL"; exit 0; }
    sleep 0.5
  done
) &

echo ""
echo "  공개 링크를 만드는 중입니다. 몇 초 뒤 아래에 '어디서든' 주소가 찍힙니다."
echo "  잠시 후 브라우저가 자동으로 열립니다. 이 창을 닫으면 게임이 끝납니다."

# exec 로 넘겨 이 셸을 node 로 갈아치웁니다. Ctrl+C 와 창 닫기가 서버에
# 그대로 가 닿아야 하기 때문입니다.
exec node server/index.js
