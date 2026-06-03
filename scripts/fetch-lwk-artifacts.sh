#!/bin/bash

# Fetch lwk-rn prebuilt native artifacts (iOS xcframework + Android jniLibs).
#
# Why: lwk-rn excludes its native artifacts from the npm tarball and downloads
# them via its own `postinstall` (node_modules/lwk-rn/fetch_artifacts.sh).
# pnpm skips dependency postinstall scripts, so a fresh `pnpm install` leaves
# the artifacts missing and the iOS `pod install` / native build then fails on
# a missing LwkRnFramework.xcframework.
#
# This script bridges that gap. It is idempotent (skips if the xcframework is
# already present) and non-fatal (warns and exits 0 on failure, e.g. offline)
# so it never breaks an install.

LWK_DIR="node_modules/lwk-rn"
FETCH_SCRIPT="$LWK_DIR/fetch_artifacts.sh"
XCFRAMEWORK="$LWK_DIR/LwkRnFramework.xcframework"

# lwk-rn not installed (or layout changed) — nothing to do.
if [ ! -f "$FETCH_SCRIPT" ]; then
  echo "[fetch-lwk-artifacts] $FETCH_SCRIPT not found, skipping."
  exit 0
fi

# Already fetched — idempotent no-op.
if [ -d "$XCFRAMEWORK" ]; then
  echo "[fetch-lwk-artifacts] LwkRnFramework.xcframework already present, skipping."
  exit 0
fi

echo "[fetch-lwk-artifacts] Fetching lwk-rn native artifacts..."
if (cd "$LWK_DIR" && sh fetch_artifacts.sh); then
  echo "[fetch-lwk-artifacts] Done."
else
  echo "[fetch-lwk-artifacts] WARNING: failed to fetch lwk-rn artifacts (offline?)." >&2
  echo "[fetch-lwk-artifacts] Re-run later with: pnpm run setup:native" >&2
fi

# Always succeed so installs are never blocked by this step.
exit 0
