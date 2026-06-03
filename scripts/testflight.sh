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
cp "$ASC_KEY_P8" "$KEY_DEST_DIR/AuthKey_${ASC_KEY_ID}.p8"

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
