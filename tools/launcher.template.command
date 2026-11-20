#!/bin/bash
#
# PokerMaster desktop launcher
#
# Don't edit this file directly: the one on the Desktop is a copy.
# Edit tools/launcher.template.command, then run `npm run launcher` again.
#
# ROOT below is filled in with this repository's absolute path at install time.

ROOT="__ROOT__"
export PORT="${PORT:-3000}"
# Start with a link invite (public link). If the tunnel fails, the server falls
# back to same-Wi-Fi mode on its own.
export SHARE=1
URL="http://localhost:$PORT"

printf '\033]0;PokerMaster\007'

# Finder opens a login shell, so PATH is usually fine. If node can't be found it
# fails with no explanation, so pin the common install locations first.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  echo ""
  echo "  $1"
  echo ""
  read -r -p "  Press Enter to close this window."
  exit 1
}

cd "$ROOT" 2>/dev/null || fail "Could not find the PokerMaster folder: $ROOT"
command -v node >/dev/null || fail "Node.js is required. Install it from https://nodejs.org and run this again."

# If our server is already up, don't start a second one. Checking only the port
# would open the browser on someone else's program on 3000, so check the reply.
if curl -fsS --max-time 1 "$URL" 2>/dev/null | grep -q PokerMaster; then
  echo ""
  echo "  Already running. Opening the browser only."
  echo "  If you don't see a public link, close the running PokerMaster window and try again."
  open "$URL"
  exit 0
fi

# If something else holds the port, node dies with a one-line EADDRINUSE.
# Explain what is going on first.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Another program is using port $PORT. Quit it, or run PORT=3001 npm start from a terminal."
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  First run: installing dependencies. One moment…"
  npm install || fail "Setup failed. Try running npm install yourself in a terminal."
fi

# Link invites need cloudflared. Offer to install it here; skipping is fine, the
# server then starts in same-Wi-Fi mode with a one-line warning.
if ! command -v cloudflared >/dev/null; then
  echo ""
  echo "  Link invites need cloudflared (one-time install)."
  if command -v brew >/dev/null; then
    read -r -p "  Install it now? [Y/n] " answer
    if [[ ! "$answer" =~ ^[Nn] ]]; then
      brew install cloudflared || echo "  Install failed. Starting in same-Wi-Fi mode."
    fi
  else
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    echo "  Install it from the page above and run this again. Starting in same-Wi-Fi mode for now."
  fi
fi

# Wait until the server actually answers before opening: too early gives a blank page.
(
  # The server only starts once the tunnel is open, so allow plenty of time.
  for _ in $(seq 1 120); do
    curl -fsS -o /dev/null --max-time 1 "$URL" 2>/dev/null && { open "$URL"; exit 0; }
    sleep 0.5
  done
) &

echo ""
echo "  Creating a public link. In a few seconds the 'Anywhere' address appears below."
echo "  The browser opens by itself shortly. Closing this window ends the game."

# exec replaces this shell with node, so Ctrl+C and closing the window reach the
# server directly.
exec node server/index.js
