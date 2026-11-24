#!/usr/bin/env bash
# Opt-in diagnostic using two already-installed, checksum-verified simulator libraries.
set -euo pipefail

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 || "$#" != 1 ]]; then
  echo 'Usage on Apple Silicon with a booted iOS simulator: bash scripts/bfa-e2e/run-beta7-compat-ios.sh /path/to/standard-beta7-rate' >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
old_ios="$(cd "$1" && pwd)/modules/kaleido-rgb/ios"
bfa_ios="$repo_dir/modules/kaleido-rgb/ios"
node - "$old_ios" "$bfa_ios" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [oldIos, bfaIos] = process.argv.slice(2);
const oldMarker = fs.readFileSync(path.join(oldIos, 'rgb_libFFI.xcframework', '.rgb-lib-version'), 'utf8').trim();
const oldPin = '0.3.0-beta.7 d3da4d3e24cd3ea2c88ba15a092d6e29b13f96fd116bf7b5a50cb3595eaa8f0e ios-only';
const oldBinding = crypto.createHash('sha256').update(fs.readFileSync(path.join(oldIos, 'RgbLib.swift'))).digest('hex');
if (oldMarker !== oldPin || oldBinding !== '50a9c605b6ae44cefce9c73ba4c6d273fb9ddd7036939795d0fe1f3c51508c57') {
  throw new Error('Install standard beta.7 using its pinned Rate installer before running this probe.');
}
const bfa = require(path.resolve(bfaIos, '../scripts/download-rgb-lib-ios.js'));
bfa.verifyBinding();
if (bfa.RGB_LIB_VERSION !== '0.3.0-beta.7-upstream-dev-bfa.8-bfa' || !bfa.isInstalled()) {
  throw new Error('Install bfa.8 using the current pinned Rate installer before running this probe.');
}
console.log('PASS verified standard beta.7 and bfa.8 binding and archive pins');
NODE

umask 077
scratch="$(mktemp -d "${TMPDIR:-/tmp}/rate-beta7-compat.XXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
slice='rgb_libFFI.xcframework/ios-arm64_x86_64-simulator'
compile() {
  xcrun --sdk iphonesimulator swiftc -sdk "$sdk" -target arm64-apple-ios16.0-simulator \
    -lc++ -lsqlite3 -framework Security -framework SystemConfiguration \
    "$@" "$script_dir/beta7-compat-ios.swift"
}

compile -D STANDARD_BETA7 -F "$old_ios/$slice" -framework rgb_libFFI \
  -Xlinker -rpath -Xlinker "$old_ios/$slice" \
  "$old_ios/RgbLib.swift" -o "$scratch/standard-probe"
compile -I "$bfa_ios/$slice/Headers" -L "$bfa_ios/$slice" -lrgblibuniffi \
  "$bfa_ios/RgbLib.swift" -o "$scratch/bfa-probe"

device="${SIMULATOR_UDID:-booted}"
xcrun simctl spawn "$device" "$scratch/standard-probe" "$scratch"
xcrun simctl spawn "$device" "$scratch/bfa-probe" "$scratch"
