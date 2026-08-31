# Changelog

All notable changes to the KaleidoSwap wallet are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> ⚠️ **Alpha.** KaleidoSwap is under active development and not production-ready.
> The KaleidoMind AI assistant is experimental and can make mistakes — review
> actions before confirming. Use test networks and small amounts only.

## [Unreleased]

## [0.2.1] — 2026-08-31

Dependency refresh (patch/minor bumps within existing semver ranges, plus an
Expo SDK 54 compatibility alignment) and a fix for the pnpm-based native
toolchain, alongside a substantial test-suite repair.

### Fixed
- **pnpm native toolchain**: pnpm ≥10 stopped reading `node-linker` from
  `.npmrc` — it must be declared in `pnpm-workspace.yaml` instead. This was
  silently breaking the flat `node_modules` layout the QVAC/bare-kit native
  addon linker depends on, causing the `postinstall` bundling step
  (`sync-qvac-bundle.js`) to fail with a `bare-process` module-resolution
  error. Moved the setting; `.npmrc` now just points at the new location.
- **Jest test suite**: 11 of 23 suites (35 tests) were failing before this
  change. All now pass (23/23 suites, 276 tests):
  - `transformIgnorePatterns` only allowed the bare `expo`/`react-native`
    packages, not their hyphenated siblings (`expo-font`, `expo-camera`,
    `react-native-reanimated`, …) — these ship ESM and need the same Babel
    transform.
  - Added mocks for `@expo/vector-icons`, `expo-audio`, `expo-file-system`,
    `expo-haptics`, and `react-native-safe-area-context` (all need a native
    `globalThis.expo` binding that only exists on-device).
  - Hand-rolled a `react-native-reanimated` mock — its own shipped mock
    still pulls in the real `react-native-worklets` native module in v4.
  - The `react-native` test mock was missing `Switch`, `Modal`, and
    `Pressable`, and `StyleSheet.flatten`, breaking
    `@testing-library/react-native`'s host-component detection.
  - `TouchableOpacity` is now a small real component (not a bare string) so
    a `disabled`/`loading` press is correctly swallowed — `fireEvent.press`
    doesn't check `disabled` itself and walks up to any ancestor's `onPress`
    if the pressed node's own handler is missing.
  - Fixed several tests asserting against a stale API: `Toast.test.tsx` was
    written against a `ToastService` shape (`addListener`/`hideToast`/
    `showSuccess`, …) that no longer exists (`subscribe`/`dismiss`/`success`,
    …); `ErrorBoundary.test.tsx`'s custom-fallback tests assumed `fallback`
    is rendered as a component when it's actually called as a plain
    `(error, errorInfo, reset)` callback; two reset-flow tests pressed
    "Try Again" while the child prop was still configured to throw, which
    just re-triggers `componentDidCatch` before the child ever gets a chance
    to render — swapped the ordering.
  - `ErrorBoundary`'s error heading was missing an `accessibilityRole`.

### Changed
- Bumped most dependencies within their existing semver ranges (`axios`,
  `expo`, `metro`, `nostr-tools`, `@scure/*`, `react-native-maps`,
  `@kaleidorg/mind`, `@kaleidorg/kaleido-ui`, `kaleido-sdk`, `@qvac/sdk`,
  and others).
- Realigned `react`, `react-dom`, `react-native`, `react-native-svg`,
  `react-native-webview`, `react-native-worklets`, `expo-haptics`, and
  `@react-native-community/netinfo` to Expo SDK 54's compatibility matrix
  via `expo install --fix` (some of these are older patches than what was
  installed — that's the SDK-recommended pairing, not a regression).
- Added `zod` and `light-bolt11-decoder` as explicit dependencies — both
  were already imported directly in the code but only worked before as
  undeclared, incidentally-hoisted transitive dependencies.

### Notes
- `@kaleidorg/wallet-engine` intentionally stays pinned at `beta.55`. A
  newer `beta.63` is available and satisfies the existing semver range, but
  it expects newer peer versions of `@kaleidorg/wdk-wallet-liquid`,
  `@kaleidorg/wdk-wallet-rln`, `@kaleidorg/wdk-protocol-swap-kaleidoswap`,
  and `@arkade-os/wdk` that this app doesn't carry yet — advancing the whole
  protocol stack together should be its own change.
- The regenerated `qvac/worker.bundle.js` / `qvac/addons.manifest.json` now
  additionally list `bare-posix` (needed by the bumped `@qvac/sdk`).
  `bare-posix` has no published Android prebuild yet, relying on the NDK
  toolchain (provisioned in `release.yml`) to build it from source on
  Android CI runs — not verified on-device as part of this change.

## [0.2.0] — 2026-06-21

First public alpha. Introduces **KaleidoMind**, an on-device (QVAC) AI assistant — in
chat and voice — woven through the multi-protocol KaleidoSwap wallet, plus a wallet,
dashboard, and navigation revamp.

### Added
- **KaleidoMind, on-device AI assistant** (chat + voice) via the QVAC SDK and the
  `@kaleidorg/mind` funnel (fast-path → recipe → agentic), running fully on the phone.
- Model picker including the larger Qwen3 4B/8B on high-RAM phones; the active model is
  shown in the chat and voice headers (model · on device / Desktop).
- `/skill` pinning — choose a skill from the `+` menu or type `/skill-name` so the model
  gets that skill's context for the message.
- Conversational **payments to Nostr contacts**: resolves the contact, fetches its
  Lightning address (`lud16`) live, and LNURL-pays the sats amount, with a confirmation card.
- `list_contacts` tool and a tappable **contact-picker card** (tap to prefill a send).
- **Merchant discovery** via live BTC Map data (v2 elements API, cached), with city
  geocoding (Nominatim) so search works without GPS, and tappable merchant cards.
- Voice mode: pause, markdown-formatted replies, copy message/thinking/full chat,
  structured invoice/merchant cards, and `lightning:` share links.
- Wallet/dashboard: multi-protocol assets and activity, refreshed balances after a
  payment, a time-based greeting, and a redesigned orbit FAB (Swap / Scan / Voice) with a
  shortcut legend.

### Changed
- KaleidoMind is clearly marked **Experimental** across onboarding and headers.
- README rewritten around the multi-protocol + on-device-AI story, with an alpha warning
  and roadmap.

### Fixed
- Voice first-recording reliability: pre-warm Whisper, warm the mic/audio session on open,
  and a mic settle delay so the first utterance is captured.
- The assistant no longer keeps thinking in the background after the voice modal is closed.
- Generate real Lightning (BOLT11) invoices instead of a Spark address.
- Number words → digits ("one satoshi" → 1) and punctuation-tolerant contact matching, so
  payment phrasings extract reliably; "no contact" errors list the real contacts to recover.
- Live BTC Map fetch (replacing flaky Overpass), tappable merchant card actions.
- Visible toasts (solid surface + safe-area spacing) and numerous navigation/UI polish.

## [0.1.0]

Initial internal release.

[Unreleased]: https://github.com/kaleidoswap/Rate/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kaleidoswap/Rate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kaleidoswap/Rate/releases/tag/v0.1.0
