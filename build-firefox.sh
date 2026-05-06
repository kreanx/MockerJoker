#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD="$DIR/build/firefox"

rm -rf "$BUILD"
mkdir -p "$BUILD"

cp -r "$DIR/extension/"* "$BUILD/"
cp "$DIR/manifest.firefox.json" "$BUILD/manifest.json"

echo "Firefox extension ready: $BUILD"
echo "Load via about:debugging → This Firefox → Load Temporary Add-on → $BUILD/manifest.json"
