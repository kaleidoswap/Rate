#!/usr/bin/env bash
#
# Build a Release archive of the KaleidoSwap wallet and upload it to TestFlight,
# fully non-interactively, using an App Store Connect API key.
#
# Prereqs (one-time, on your Apple Developer account):
#   1. A paid Apple Developer Program membership (the desktop-app already uses one).
#   2. An App Store Connect API key — App Store Connect ▸ Users and Access ▸
#      Integrations ▸ App Store Connect API ▸ generate (role: Admin or App Manager).
#      Download the AuthKey_XXXXXXXXXX.p8 (you can only download it ONCE).
#   3. An App Store Connect app record for the bundle id (com.kaleidoswap.wallet).
#      If it doesn't exist yet, create it: Apps ▸ + ▸ New App (platform iOS,
#      bundle id com.kaleidoswap.wallet, SKU anything, primary language English).
#
# Usage:
#   ASC_KEY_P8=/path/to/AuthKey_ABC123.p8 \
#   ASC_KEY_ID=ABC123XYZ \
#   ASC_ISSUER_ID=11111111-2222-3333-4444-555555555555 \
#   TEAM_ID=644JA45Z2S \
#   bash scripts/testflight.sh
#
set -euo pipefail

# --- Ruby/CocoaPods need a UTF-8 locale (Ruby 3.4 crashes otherwise) ----------
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# --- Resolve paths ------------------------------------------------------------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Load App Store Connect creds from a gitignored file ----------------------
# Put ASC_KEY_P8 / ASC_KEY_ID / ASC_ISSUER_ID / TEAM_ID in .env.testflight.local
# (gitignored — see .env.testflight.example) so a deploy is a single command.
# The file is the source of truth; comment a line out to fall back to the env.
if [ -f "$ROOT/.env.testflight.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env.testflight.local"
  set +a
fi

WORKSPACE="ios/KaleidoSwap.xcworkspace"
SCHEME="KaleidoSwap"
CONFIG="Release"
BUILD_DIR="$ROOT/build"
ARCHIVE="$BUILD_DIR/KaleidoSwap.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
TEAM_ID="${TEAM_ID:-644JA45Z2S}"

# --- Validate inputs ----------------------------------------------------------
: "${ASC_KEY_P8:?Set ASC_KEY_P8 to the path of your AuthKey_*.p8}"
: "${ASC_KEY_ID:?Set ASC_KEY_ID (the Key ID, e.g. ABC123XYZ)}"
: "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID (the Issuer ID UUID)}"
[ -f "$ASC_KEY_P8" ] || { echo "ASC_KEY_P8 not found: $ASC_KEY_P8" >&2; exit 1; }

# altool/xcodebuild discover the key from these well-known dirs.
KEY_DEST_DIR="$HOME/.appstoreconnect/private_keys"
mkdir -p "$KEY_DEST_DIR"
KEY_DEST="$KEY_DEST_DIR/AuthKey_${ASC_KEY_ID}.p8"
# Skip the copy when the key is already at the destination (cp would error on an identical file).
if [ ! "$ASC_KEY_P8" -ef "$KEY_DEST" ]; then
  cp "$ASC_KEY_P8" "$KEY_DEST"
fi

# --- Bump the iOS build number (CFBundleVersion) ------------------------------
# TestFlight rejects a build number it has already seen, so bump before every
# upload. The project uses apple-generic versioning, so agvtool bumps it across
# all configs + Info.plist. Set SKIP_BUMP=1 to upload the current number as-is.
if [ "${SKIP_BUMP:-0}" != "1" ]; then
  echo "==> bump build number"
  ( cd ios && agvtool next-version -all >/dev/null )
  NEW_BUILD="$(cd ios && agvtool what-version -terse)"
  # Keep app.json's (cosmetic, native value is authoritative) in sync.
  node -e "const f='app.json',a=require('./'+f);a.expo.ios.buildNumber=String($NEW_BUILD);require('fs').writeFileSync(f,JSON.stringify(a,null,2)+'\n')"
  echo "    build number is now $NEW_BUILD — commit ios/ + app.json after a successful upload"
fi

# --- Install CocoaPods deps ---------------------------------------------------
echo "==> pod install"
( cd ios && pod install )

# --- Materialize ExportOptions with the real team id --------------------------
EXPORT_PLIST="$BUILD_DIR/ExportOptions.plist"
mkdir -p "$BUILD_DIR"
sed "s/__TEAM_ID__/$TEAM_ID/" "$ROOT/scripts/ExportOptions.plist" > "$EXPORT_PLIST"

# --- Archive (auto provisioning creates the iOS distribution cert + profile) --
echo "==> archive"
rm -rf "$ARCHIVE"
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -archivePath "$ARCHIVE" \
  -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_DEST_DIR/AuthKey_${ASC_KEY_ID}.p8" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Automatic

# --- Export the .ipa ----------------------------------------------------------
echo "==> export ipa"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_DEST_DIR/AuthKey_${ASC_KEY_ID}.p8" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID"

IPA="$(ls "$EXPORT_DIR"/*.ipa | head -1)"
echo "==> built: $IPA"

# --- Upload to App Store Connect / TestFlight ---------------------------------
echo "==> upload to TestFlight"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA" \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"

echo "==> Done. The build will appear in App Store Connect ▸ TestFlight in a few"
echo "    minutes (after Apple finishes processing). Add yourself as an internal"
echo "    tester to install via the TestFlight app."
