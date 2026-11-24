#!/usr/bin/env bash
# Test the pinned bfa.8 iOS simulator library with one fresh, unfunded Regtest wallet.
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'The bfa.8 probe requires macOS on Apple Silicon and a booted iOS simulator.' >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
rgb_module="$repo_dir/modules/kaleido-rgb"
node - "$rgb_module/scripts/download-rgb-lib-ios.js" <<'NODE'
const pins = require(process.argv[2]);
if (pins.RGB_LIB_VERSION !== '0.3.0-beta.7-upstream-dev-bfa.8-bfa') {
  throw new Error('The probe requires the bfa.8 native version.');
}
pins.verifyBinding();
if (!pins.isInstalled()) {
  throw new Error('Install the verified xcframework with modules/kaleido-rgb/scripts/download-rgb-lib-ios.js first.');
}
console.log(`PASS verified binding and installed archive pin ${pins.RGB_LIB_VERSION}`);
NODE

umask 077
scratch="$(mktemp -d "${TMPDIR:-/tmp}/rate-bfa-ios.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT
slice="$rgb_module/ios/rgb_libFFI.xcframework/ios-arm64_x86_64-simulator"
xcrun --sdk iphonesimulator swiftc \
  -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
  -target arm64-apple-ios16.0-simulator \
  -I "$slice/Headers" -L "$slice" -lrgblibuniffi -lc++ -lsqlite3 \
  -framework Security -framework SystemConfiguration \
  "$rgb_module/ios/RgbLib.swift" "$script_dir/offline-ios.swift" \
  -o "$scratch/bfa8-probe"

xcrun simctl spawn "${SIMULATOR_UDID:-booted}" "$scratch/bfa8-probe" "$scratch"
