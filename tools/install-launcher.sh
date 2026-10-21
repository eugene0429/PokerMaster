#!/bin/bash
#
# 바탕화면에 더블클릭용 PokerMaster 아이콘을 깝니다. 링크 초대 모드
# (npm run share)로 켜져서, 같은 와이파이가 아닌 친구도 링크로 부를 수 있습니다.
#
#   npm run launcher              바탕화면에 설치
#   npm run launcher -- ~/원하는/폴더   다른 곳에 설치
#
# 다시 실행하면 그 자리에 덮어씁니다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$HOME/Desktop}"

[ -d "$DEST" ] || { echo "폴더가 없습니다: $DEST"; exit 1; }

node "$ROOT/tools/make-icon.mjs"

TARGET="$DEST/PokerMaster.command"

# 런처 본문에 이 저장소의 절대경로를 박아 넣습니다. 사본이 바탕화면에 놓이는
# 이상 스스로는 저장소를 찾을 수 없기 때문입니다.
sed "s|__ROOT__|$ROOT|g" "$ROOT/tools/launcher.template.command" > "$TARGET"
chmod +x "$TARGET"

# 아이콘 붙이기: .icns 에 아이콘 리소스를 심고(sips -i), 그 리소스를 떼어내
# (DeRez) 대상 파일의 리소스 포크에 덧붙인 뒤(Rez), 커스텀 아이콘 플래그를 켭니다.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/tools/PokerMaster.icns" "$TMP/icon.icns"
sips -i "$TMP/icon.icns" >/dev/null
DeRez -only icns "$TMP/icon.icns" > "$TMP/icon.rsrc"
Rez -append "$TMP/icon.rsrc" -o "$TARGET"
SetFile -a C "$TARGET"     # 커스텀 아이콘 있음
SetFile -a E "$TARGET"     # Finder 에서 .command 확장자 숨김

# Finder 는 아이콘을 캐시합니다. 수정 시각을 건드려 다시 읽게 합니다.
touch "$TARGET"

# 예전 설치가 남긴 링크 초대 전용 아이콘은 이제 이 아이콘과 같으므로 치웁니다.
rm -f "$DEST/PokerMaster 링크 초대.command"

echo "설치 완료: $TARGET"
echo "바탕화면의 PokerMaster 를 더블클릭하면 게임이 열리고, 친구를 부를 공개 링크가 터미널에 찍힙니다."
