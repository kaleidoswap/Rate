#!/usr/bin/env bash
#
# Link the QVAC / Bare native addon xcframeworks into the iOS app.
#
# WHY: react-native-bare-kit's pod vendors `ios/addons/*.xcframework`, generated
# by its `prepare_command` (`node ios/link.mjs`). On a clean checkout these are
# NOT in node_modules, and if the link step doesn't run (or runs the stock
# all-addons variant), the worklet aborts at launch with:
#     AddonError: ADDON_NOT_FOUND … bare-abort.<v>.framework
# which hard-crashes the app (uncatchable abort in the Bare runtime).
#
# This script reproduces what the @qvac/sdk expo plugin (withMobileBundle) is
# meant to do: install the manifest-aware link script (only the addons in
# qvac/addons.manifest.json) and run it, then pod install so the frameworks are
# embedded. Run after `npm install`, after `expo prebuild`, or any time the
# worklet can't find an addon.
#
# Usage:  bash scripts/link-bare-addons.sh   (from the project root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BAREKIT="$ROOT/node_modules/react-native-bare-kit"
PATCH="$ROOT/node_modules/@qvac/sdk/expo/plugins/patches/ios-link.mjs"

if [ ! -d "$BAREKIT" ]; then
  echo "[link-bare-addons] react-native-bare-kit not installed — run npm install first." >&2
  exit 1
fi

# Use the QVAC manifest-aware link script (links only the allowlisted addons)
# when available; otherwise fall back to bare-kit's stock link.mjs.
if [ -f "$PATCH" ]; then
  echo "[link-bare-addons] installing manifest-aware link.mjs"
  cp "$PATCH" "$BAREKIT/ios/link.mjs"
fi

echo "[link-bare-addons] generating addon xcframeworks (node ios/link.mjs)…"
( cd "$BAREKIT" && node ios/link.mjs )

COUNT="$(ls "$BAREKIT/ios/addons" 2>/dev/null | grep -c xcframework || true)"
echo "[link-bare-addons] $COUNT xcframeworks in node_modules/react-native-bare-kit/ios/addons"
if [ ! -d "$BAREKIT/ios/addons/bare-abort."*".xcframework" ] 2>/dev/null; then
  ls "$BAREKIT/ios/addons" | grep -q bare-abort || {
    echo "[link-bare-addons] WARNING: bare-abort xcframework missing — the worklet will crash." >&2
  }
fi

echo "[link-bare-addons] running pod install…"
( cd "$ROOT/ios" && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install )

echo "[link-bare-addons] done. Now build a fresh native app: npx expo run:ios --device"
