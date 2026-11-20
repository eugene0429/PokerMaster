#!/bin/bash
#
# Puts a double-clickable PokerMaster icon on the Desktop. It starts in link
# invite mode (npm run share), so friends who are not on your Wi-Fi can join.
#
#   npm run launcher                     install on the Desktop
#   npm run launcher -- ~/some/folder    install somewhere else
#
# Running it again overwrites the previous copy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$HOME/Desktop}"

[ -d "$DEST" ] || { echo "No such folder: $DEST"; exit 1; }

node "$ROOT/tools/make-icon.mjs"

TARGET="$DEST/PokerMaster.command"

# Bake this repository's absolute path into the launcher: once the copy sits on
# the Desktop it has no other way to find the repository.
sed "s|__ROOT__|$ROOT|g" "$ROOT/tools/launcher.template.command" > "$TARGET"
chmod +x "$TARGET"

# Attach the icon: embed an icon resource in the .icns (sips -i), extract it
# (DeRez), append it to the target's resource fork (Rez), then set the custom
# icon flag.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/tools/PokerMaster.icns" "$TMP/icon.icns"
sips -i "$TMP/icon.icns" >/dev/null
DeRez -only icns "$TMP/icon.icns" > "$TMP/icon.rsrc"
Rez -append "$TMP/icon.rsrc" -o "$TARGET"
SetFile -a C "$TARGET"     # has a custom icon
SetFile -a E "$TARGET"     # hide the .command extension in Finder

# Finder caches icons. Touch the file so it reads the new one.
touch "$TARGET"

# Older installs left a separate link-invite launcher; this one replaces it.
rm -f "$DEST/PokerMaster 링크 초대.command"

echo "Installed: $TARGET"
echo "Double-click PokerMaster on the Desktop to open the game. The public link for your friends appears in the terminal."
