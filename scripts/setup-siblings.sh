#!/usr/bin/env bash
# Clone (or update) the sibling repos this app imports from source, and install
# their dependencies. Needed before `expo run:*` / `expo start`, or Metro can't
# resolve @universal-bolt12/* (see services/kaleidoPay/README.md).
#
#   pnpm run setup:siblings
#
# Set UNIVERSAL_BOLT12_DIR to use a checkout somewhere other than ../universal-bolt12.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${UNIVERSAL_BOLT12_DIR:-$ROOT/../universal-bolt12}"
REPO="https://github.com/kaleidoswap/universal-bolt12"

if [ -d "$DIR/.git" ]; then
  echo "==> Updating $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "==> Cloning $REPO into $DIR"
  git clone "$REPO" "$DIR"
fi

echo "==> Installing universal-bolt12 dependencies"
(cd "$DIR" && npm ci --ignore-scripts --no-audit --no-fund)
echo "==> Done. Metro, tsc and Jest resolve @universal-bolt12/* from $DIR"
