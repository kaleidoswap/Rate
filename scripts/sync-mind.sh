#!/usr/bin/env bash
# Dev convenience: overlay the locally-built @kaleidorg/mind onto the installed
# package so the app runs the working-tree core (the npm-published version can
# lag the sibling repo during active development).
#
# The cases this distinguishes — the old one-liner swallowed all of them with
# `2>/dev/null || echo`, which silently shipped stale code:
#
#   1. Sibling repo ABSENT (EAS/CI clones only `rate`): skip quietly. The build
#      then uses the npm-published @kaleidorg/mind pinned in package.json — so
#      that pin MUST be the version you actually intend to ship.
#   2. Sibling PRESENT but its dist is missing: warn LOUDLY. Almost always means
#      core wasn't built; silently overlaying nothing (or stale output) is the
#      exact bug this guard exists to catch.
#   3. rsync itself fails: surface a non-zero exit instead of hiding it.

set -uo pipefail

SRC="../kaleido-mind/packages/core"
DEST="node_modules/@kaleidorg/mind/dist"

if [ ! -d "$SRC" ]; then
  echo "sync-mind: local core not found at $SRC — using published @kaleidorg/mind."
  exit 0
fi

if [ ! -d "$SRC/dist" ]; then
  echo "" >&2
  echo "  ⚠️  sync-mind: found local core at $SRC but $SRC/dist is missing." >&2
  echo "      The app will run the PUBLISHED @kaleidorg/mind, which may be stale." >&2
  echo "      Build the local core first:  (cd $SRC && pnpm build)" >&2
  echo "" >&2
  exit 0
fi

if [ ! -d "$DEST" ]; then
  echo "sync-mind: $DEST not present (is @kaleidorg/mind installed?) — skipping." >&2
  exit 0
fi

rsync -a --delete "$SRC/dist/" "$DEST/"
# Also overlay package.json so its `exports` map matches the working tree — e.g.
# the `./qvac` subpath (the QVAC adapter, which ships inside core's dist) won't
# resolve via tsc/Metro until the installed package.json advertises it.
cp "$SRC/package.json" "node_modules/@kaleidorg/mind/package.json"
echo "sync-mind: overlaid local @kaleidorg/mind ($SRC/dist + package.json) → $DEST"
# The QVAC adapter ships as the @kaleidorg/mind/qvac subpath inside core's dist,
# so this single overlay already carries it — no separate sync needed.
