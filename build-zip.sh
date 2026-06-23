#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$DIR/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

# Firefox build
FIREFOX="$DIR/build/firefox"
rm -rf "$FIREFOX"
mkdir -p "$FIREFOX"
cp -r "$DIR/extension/"* "$FIREFOX/"
cp "$DIR/manifest.firefox.json" "$FIREFOX/manifest.json"

# Chrome unpacked (for "Load unpacked" in chrome://extensions)
CHROME="$DIR/build/chrome"
rm -rf "$CHROME"
mkdir -p "$CHROME"
cp -r "$DIR/extension/"* "$CHROME/"
echo "Chrome unpacked: $CHROME"

# Chrome ZIP
cd "$DIR/extension"
zip -r "$DIST/mock-extention-chrome.zip" . \
  -x "*.DS_Store" -x "__MACOSX/*"
echo "Chrome ZIP: $DIST/mock-extention-chrome.zip"

# Firefox ZIP
cd "$FIREFOX"
zip -r "$DIST/mock-extention-firefox.zip" . \
  -x "*.DS_Store" -x "__MACOSX/*"
echo "Firefox ZIP: $DIST/mock-extention-firefox.zip"

echo ""
echo "Готово! Файлы в $DIST/"
echo "  $CHROME   — для Chrome (unpacked, chrome://extensions → Load unpacked)"
echo "  $FIREFOX  — для Firefox (unpacked, about:debugging → This Firefox → Load Temporary Add-on)"
echo ""
echo "  $DIST/mock-extention-chrome.zip    — для Google Chrome (zip)"
echo "  $DIST/mock-extention-firefox.zip   — для Mozilla Firefox (zip)"
