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
echo "  mock-extention-chrome.zip   — для Google Chrome"
echo "  mock-extention-firefox.zip  — для Mozilla Firefox"
