#!/usr/bin/env bash
# Use a dedicated directory outside the checkout: it contains TEST-ONLY keys.
# Usage: bash scripts/rgb-e2e/run.sh /absolute/test-state prepare|switch|send|status
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
state_dir="${1:?Pass an absolute directory for the isolated test wallets}"
mode="${2:-status}"
[[ "$state_dir" = /* ]] || { echo 'State directory must be absolute' >&2; exit 64; }
case "$mode" in failure-tests|backup-export|backup-restore|prepare|switch|connect-networks|send|status|app-prepare|app-send|app-status|extended-invalid-invoices|extended-prepare|extended-send|extended-fund|extended-utxos|extended-offline|extended-status) ;; *) echo 'Unknown mode' >&2; exit 64 ;; esac
umask 077
mkdir -p "$state_dir"
probe_bin="$state_dir/native-probe"
bindings="$repo_dir/modules/kaleido-rgb/ios/RgbLib.swift"
source_file="$repo_dir/scripts/rgb-e2e/native.swift"
mappers="$repo_dir/modules/kaleido-rgb/ios/Mappers.swift"
framework_dir="$repo_dir/modules/kaleido-rgb/ios/rgb_libFFI.xcframework/ios-arm64_x86_64-simulator"
if [[ ! -x "$probe_bin" || "$bindings" -nt "$probe_bin" || "$source_file" -nt "$probe_bin" || "$mappers" -nt "$probe_bin" || "$framework_dir/rgb_libFFI.framework/rgb_libFFI" -nt "$probe_bin" ]]; then
  xcrun --sdk iphonesimulator swiftc \
    -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" \
    -target arm64-apple-ios16.0-simulator -F "$framework_dir" -framework rgb_libFFI \
    "$bindings" "$mappers" "$source_file" -o "$probe_bin" 2> "$state_dir/build.log"
fi
# SIMULATOR_UDID can select an already-booted device explicitly.
xcrun simctl spawn "${SIMULATOR_UDID:-booted}" "$probe_bin" "$state_dir" "$mode"
