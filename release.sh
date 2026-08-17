#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ -z "${1:-}" ]; then
  echo "Usage: ./release.sh <version>"
  echo "Example: ./release.sh 5.0.2"
  exit 1
fi

VERSION="$1"
TAG="v$VERSION"
BRANCH=$(git branch --show-current)

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists!"
  exit 1
fi

echo "Releasing $TAG on branch $BRANCH"

sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" extension/manifest.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" manifest.firefox.json

bash build-zip.sh

git add extension/manifest.json manifest.firefox.json
git commit -m "release: $TAG"
git tag "$TAG"
git push origin "$BRANCH"
git push origin "$TAG"

echo ""
echo "Done! $TAG pushed. GitHub Actions will create the Release."
