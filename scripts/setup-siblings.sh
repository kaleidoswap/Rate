#!/usr/bin/env bash
# Clone (or update) the sibling repos this app imports from source, and install
# their dependencies. Needed before `expo run:*` / `expo start`, or Metro can't
# resolve @universal-bolt12/* (see services/kaleidoPay/README.md).
#
#   pnpm run setup:siblings
#
# Set UNIVERSAL_BOLT12_DIR to use a checkout somewhere other than ../universal-bolt12.
# The checkout is moved to the commit pinned in kaleido-pay.ref (the one CI and
# release builds use). Set KALEIDO_PAY_REF=current to keep whatever is checked out,
# e.g. while developing kaleido-pay itself.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${UNIVERSAL_BOLT12_DIR:-$ROOT/../universal-bolt12}"
REPO="https://github.com/kaleidoswap/kaleido-pay"
REF="${KALEIDO_PAY_REF:-$(tr -d '[:space:]' < "$ROOT/kaleido-pay.ref")}"

if [ ! -d "$DIR/.git" ]; then
  echo "==> Cloning $REPO into $DIR"
  git clone "$REPO" "$DIR"
fi
if [ "$REF" != "current" ]; then
  echo "==> Checking out pinned kaleido-pay commit $REF"
  git -C "$DIR" fetch origin
  git -C "$DIR" checkout --detach "$REF"
fi

echo "==> Installing universal-bolt12 dependencies"
(cd "$DIR" && npm ci --ignore-scripts --no-audit --no-fund)
echo "==> Done. Metro, tsc and Jest resolve @universal-bolt12/* from $DIR"
