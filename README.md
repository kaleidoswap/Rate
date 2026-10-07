# KaleidoSwap Wallet

**A non-custodial, multi-protocol Bitcoin wallet with an on-device AI assistant.**

KaleidoSwap is a React Native (Expo) mobile wallet that brings Bitcoin, the Lightning
Network, RGB assets, and Bitcoin L2s (Spark, Arkade, Bark) together under one
self-custodial roof — driven by a private, **on-device** AI assistant and Nostr social
payments. Your keys, your assets, and your AI all stay on your phone.

> ⚠️ **Alpha software.** KaleidoSwap is under active development and **not production-ready**.
> Expect bugs, breaking changes, and incomplete features. The KaleidoMind AI assistant is
> **experimental** and can make mistakes — always review actions before confirming. Use
> test networks and small amounts only; **do not store funds you can't afford to lose.**

---

## Highlights

- 🔑 **Non-custodial & multi-protocol** — one HD wallet (BIP39) across Bitcoin on-chain,
  Lightning, RGB assets, Spark, Arkade, and Bark.
- 🤖 **On-device AI** — a private assistant (KaleidoMind) that runs the LLM and speech
  models locally; nothing is sent to a cloud LLM by default.
- 🔁 **Atomic swaps** — trustless asset swaps via the KaleidoSwap maker network, plus
  Flashnet AMM pools on Spark.
- 🌐 **Nostr-native** — contacts, Lightning Zaps, Lightning Address, and NWC
  (Nostr Wallet Connect) to pair external apps.
- 🗺️ **Real-world spending** — discover Bitcoin-accepting merchants via BTC Map.
- 🔒 **Hardened by default** — biometric unlock, and seeds and keys held in the
  device secure store (never in the local database).

---

## Supported protocols

KaleidoSwap is built on a shared multi-protocol engine (`@kaleidorg/wallet-engine`)
that routes operations to the active protocol adapter:

| Protocol | What it covers | Backed by |
|---|---|---|
| **Bitcoin / Lightning + RGB** | On-chain BTC, Lightning payments, and RGB asset transfers via an RGB Lightning Node | `kaleido-sdk` (RLN) |
| **Spark** | Spark L2 Bitcoin + tokens | `@buildonspark/spark-sdk` |
| **Arkade** | Ark VTXOs | `@arkade-os/sdk` |
| **Flashnet** | Spark AMM DEX pools | `@flashnet/sdk` |

Swaps are **KaleidoSwap-first**: the wallet quotes and executes trustless atomic swaps
against the KaleidoSwap maker API, with additional venues for breadth:

- **KaleidoSwap** — maker-based atomic swaps (primary).
- **Flashnet** — Spark AMM DEX pools.

---

## The AI assistant (KaleidoMind)

The assistant is a natural-language interface to the wallet — ask it to check balances,
create invoices, send payments, swap assets, or find merchants, in chat or by voice.

- **Private by default.** The LLM (Qwen3.5 0.8B / 2B, by device RAM) and Whisper speech-to-text run **on
  device** through the [QVAC SDK](https://www.npmjs.com/package/@qvac/sdk). Conversations
  and transcription don't leave your phone.
- **One agent for chat and voice.** A single runner (`services/mindAgent.ts`) powers both
  text chat and hands-free voice, built on the shared `@kaleidorg/mind` engine.
- **Physical device required.** On-device inference is **not available on a simulator /
  emulator** (the rest of the wallet works fine on one). First launch downloads the
  models (~0.5–1.3 GB LLM + ~80 MB Whisper).

---

## Architecture

`index.ts` (polyfills) → `App.tsx` (Redux + PersistGate + Theme + ErrorBoundary) →
`navigation/` (pre-auth setup flow ↔ main tabs + modals).

- **State** — Redux Toolkit + Redux Persist (`store/`).
- **Service layer** (`services/`) keeps screens free of direct SDK calls. At its center is
  **ProtocolManager** (`services/protocols/`), which routes every operation to the active
  protocol adapter (Spark, Arkade, RGB/RLN, Flashnet). Alongside it: the
  KaleidoMind agent (`mindAgent.ts` + `*Tools.ts`), on-device AI lifecycle
  (`QVACService.ts`), Nostr + NWC, and biometric auth + encrypted SQLite.
- **Theming** — design tokens in `theme/`, shared UI primitives in `components/`.

> A legacy single-node path (`RGBApiService.ts`, `WalletManager.ts`) is **deprecated**,
> superseded by ProtocolManager.

---

## Tech stack

- **App** — React Native 0.81 + Expo SDK 54 (New Architecture), TypeScript
- **State** — Redux Toolkit, Redux Persist
- **Storage** — `expo-sqlite` for wallet metadata; `expo-secure-store` for seeds and keys
- **AI / voice** — `@qvac/sdk` (on-device LLM + Whisper), `@kaleidorg/mind`
- **Wallet engine** — `@kaleidorg/wallet-engine` + protocol SDKs (Spark, Arkade, RGB, Flashnet)
- **Nostr** — `@nostr-dev-kit/ndk`, `nostr-tools`
- **Maps** — BTC Map in `react-native-webview` + BTC Map API

---

## Quick Start

### Dependency security

Run `pnpm audit` and `pnpm test:dependency-security` after dependency updates.
The latter checks malformed URL handling and Expo Metro image parsing against
the installed packages, including the CommonJS compatibility patch for
`decode-uri-component@0.5.0`. The patch changes only its module export, preserving
the upstream decoder fix. Expo Metro 0.83.3 is also patched to pass image file
contents to image-size 2 instead of its removed filename API. Install with pnpm
so the overrides and patches apply.

As of 2026-10-07, the dependency audit reports three remaining advisories with no
patched npm release: [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
(Expo CLI), [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
(Metro/Jest glob handling), and
[sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
(Jest's configuration loader). They remain visible in the audit; no advisory is
ignored. These dependency paths describe tooling usage, not a guarantee that all
possible uses are safe. Recheck upstream fixes before release.

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** ≥ 10 (`npm i -g pnpm`). This repo uses pnpm; mixing in `npm install` is not supported.
- **Watchman** (recommended): `brew install watchman`.
- **For iOS:** macOS with **Xcode 16+** (iOS 18 SDK) and **CocoaPods** (`brew install cocoapods`). A **UTF-8 locale** is required (CocoaPods on Ruby 3.4 crashes otherwise).
- **For Android:** **Android Studio** + SDK (API 34+), a configured emulator or a connected device, and **JDK 17**.

> The app uses the **New Architecture** (default on Expo SDK 54).

### Install dependencies

```bash
git clone https://github.com/kaleidoswap/Rate.git
cd Rate
pnpm install        # postinstall prepares the Bark native module and QVAC addons
```

`pnpm install` resolves the multi-protocol stack (Spark, RLN/RGB, Arkade, Bark). Several
are local `file:` siblings (`../wallet-engine`, `../wdk-wallet-*`, `../arkade-wdk`), so keep
those checked out next to this repo.

> ⚠️ **Do not symlink `node_modules`** (e.g. `ln -s` into another checkout). A self-referencing link causes `ELOOP: too many symbolic links`. If you hit it: `rm node_modules && pnpm install`.

### Native setup (Bark)

Bark's prebuilt native artifacts are fetched and prepared by this repo's own
`postinstall` (pnpm skips dependency postinstall scripts). If a native build
complains about missing Bark artifacts, run the step manually:

```bash
pnpm run setup:native
```

### Run on iOS

```bash
# CocoaPods (Ruby 3.4) needs a UTF-8 locale — export it for the session:
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# Build + install + launch on a simulator (runs prebuild + pod install + xcodebuild):
npx expo run:ios

# …or pick a specific simulator / device:
npx expo run:ios --device "iPhone 16 Pro"
```

Notes:
- The **first build is slow** — it compiles the native modules, including Bark and the Spark/RGB SDKs.
- Bark 0.25.0 uses UniFFI 0.31.0-5. `scripts/prepare-bark-native.js` runs during `postinstall` and `setup:native`: it copies Bark's exact header-only runtime into its native package, isolates C++ namespaces and FFI type names, and removes only Bark's shared CocoaPods runtime dependency, so another UniFFI-based module can't clash with it. Do not replace this with a global version override: UniFFI string/buffer APIs differ between versions. Native artifacts are fetched by Bark's checksum-verifying installer when missing.
- When upgrading Bark or its UniFFI runtime, review the isolation script's version checks, run `pnpm run test:native-setup`, and rebuild the native app. A JavaScript reload cannot add the Bark native module to an old client.
- If `pod install` crashes with a Ruby `Unicode Normalization … ASCII-8BIT` error, you forgot the `LANG=en_US.UTF-8` export above.
- The **QVAC AI assistant requires a physical device** (no simulator support); the wallet itself runs fine on a simulator.

### Run on Android

```bash
# Have an emulator running (or a device connected — check with `adb devices`), then:
npx expo run:android
```

Notes:
- First build compiles the native modules + Gradle — allow several minutes.

### Run the dev server (after a native build is installed)

Once the app is installed on a simulator/device/emulator, you only need Metro for JS changes:

```bash
npx expo start --dev-client    # then press `i` for iOS or `a` for Android
```

### AI assistant & voice (on-device)

The AI assistant and voice mode (speech-to-text + text-to-speech) run **on-device
via the QVAC SDK, which requires a physical device** — they are unavailable on an
iOS simulator / Android emulator. The rest of the wallet works fine on a simulator.
QVAC logs are silent by default; set `"loggerConsoleOutput": true` (and
`"loggerLevel": "debug"` for native backend output) in `qvac.config.json` while
debugging.

### Managing the QVAC install (dev)

The on-device AI ships as a `bare` worker bundle plus natively-linked addons. The JS
worker bundle and the native addons must stay **in lockstep** — a stale bundle can request
an addon version that isn't in the native app and crash with `ADDON_NOT_FOUND`.
`pnpm install` keeps them aligned via `postinstall`, but when you change QVAC-related deps
or hit addon errors, re-sync manually:

```bash
pnpm run sync-qvac-bundle   # regenerate the QVAC worker bundle + relink native addons
```

Notes:
- `qvac.config.json` lists the enabled QVAC plugins (LLM completion, Whisper
  transcription, TTS) — edit it to add/remove on-device capabilities, then re-run
  `sync-qvac-bundle`.
- `@qvac/sdk` 0.21 ships the speech and LLM engines as split addons whose
  Android/iOS prebuilds live in per-platform packages (`@qvac/*-android-arm64`,
  `@qvac/*-ios`). They are pinned in `package.json` at the versions the SDK's
  addons need; when bumping `@qvac/sdk`, `sync-qvac-bundle` names any that must
  change.
- After changing native addons you must **rebuild** the app (`npx expo run:ios/android`);
  a Metro reload alone won't pick them up.
- Models are **not** bundled — they download on first launch on a physical device
  (~0.5–1.3 GB LLM + ~80 MB Whisper).
- Agent skills are bundled separately: `pnpm run bundle-skills` regenerates
  `skills.bundle.json` from the shared `@kaleidorg/mind` skills plus the
  app-specific ones in `skills/`.

---

## Usage

### First-time setup

1. **Create or restore** a wallet (12-word BIP39 recovery phrase).
2. **Secure it** — set a password and enable biometric unlock.
3. **Back up** your recovery phrase offline.
4. **Connect** — the app configures the protocol adapters for your selected network.

### Everyday operations

- **Send / Receive** — across Bitcoin, Lightning, RGB, Spark, Arkade, and Bark; scan
  Bitcoin addresses, Lightning invoices, RGB invoices, and LNURL via the QR scanner.
- **Swap** — quote and execute atomic swaps via the KaleidoSwap maker network (and
  Flashnet AMM where available).
- **Ask the assistant** — "send 50,000 sats to John", "create an invoice for $25", "swap
  10 USDT to BTC", or "find coffee shops that accept Bitcoin" — by text or voice.
- **Social** — Zap Nostr contacts, pay a Lightning Address, or connect an external app
  with NWC.

---

## Testing

```bash
npm test                # run all tests
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
npx jest path/to/file.test.ts   # single file
```

Coverage floor (enforced by `jest.config.js` and checked in CI): current coverage, about 36% statements/lines, 35% functions, 34% branches. Raise it as tests are added.

---

## Building

This is a **prebuilt** Expo project (it has `ios/` and `android/` directories), so use
`expo run:*`, not `expo start --ios/--android`.

### Development

```bash
npx expo run:ios          # iOS simulator/device (first build compiles native code)
npx expo run:android      # Android emulator/device
npx expo start --dev-client   # JS-only changes after a native build is installed
```

### Production (EAS)

Build profiles live in `eas.json` (`development`, `preview`, `production`):

```bash
eas build --profile development --platform ios      # dev client, internal distribution
eas build --profile preview     --platform android  # internal test build
eas build --profile production   --platform ios      # store build (auto-increments version)
```

---

## Project structure

```
rate/
├── screens/        # React Native screens
├── services/       # Business logic, protocol adapters, AI agent, integrations
├── store/          # Redux slices, hooks, selectors
├── components/     # Reusable UI primitives
├── navigation/     # Navigation configuration
├── theme/          # Design tokens (dark)
├── hooks/          # React hooks (e.g. useProtocol)
├── utils/          # Helpers (account routing, swap model, …)
├── skills/         # KaleidoMind agent skills
├── types/          # TypeScript definitions
└── assets/         # Static assets
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ELOOP: too many symbolic links … node_modules` | A self-referencing `node_modules` symlink. `rm node_modules && pnpm install`. |
| iOS `pod install` → `Unicode Normalization … ASCII-8BIT` | `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before running. |
| `npx expo` prompts to install a different Expo version | `node_modules` is broken — reinstall so the local `expo` is used. |
| AI assistant unavailable | On-device inference needs a **physical device**, or pair a desktop KaleidoMind provider. |

---

## Roadmap

The next chapters of KaleidoSwap, grouped by horizon. Items move up as they land.

### Now — in progress

- **Agentic-first wallet** — promote the KaleidoMind agent from a tab to the *primary*
  interface: agent-driven send / receive / swap, multi-step task execution, proactive
  suggestions, and persistent on-device memory.
- **White Noise chats by default** — adopt [White Noise](https://github.com/parres-hq/whitenoise)
  (MLS-over-Nostr) as the default end-to-end-encrypted messaging layer for 1:1 and group
  chat, with payments embedded directly in conversation.
- **Lite vs Advanced modes** — a real mode switch: **Lite** hides protocol plumbing (one
  balance; send / receive / swap / chat), **Advanced** exposes per-protocol accounts,
  channels / LSP, RGB internals, and node settings.

### Next

- **Nostr profile onboarding & key management** — first-run Nostr identity setup (profile,
  relays, NIP-05), clean separation of the wallet seed from the Nostr identity key,
  import / export of the Nostr key, and per-app NWC key scoping.
- **Light mode** — finish the theming migration (move screens from the static dark `theme`
  onto `useAppTheme()` so the Light / System toggle becomes real).
- **Background payments & notifications** — reliable incoming-payment and swap-status push
  via `expo-background-task` + `expo-notifications`.

### Later

- **Encrypted cloud backup & recovery** — beyond the 12 words: encrypted backup of
  contacts, Nostr identity, and app settings.
- **Hardware-signer / external-key support** — sign with an external key device.
- **Multi-language (i18n)** — localization for a broader audience.
- **Per-protocol UX maturity** — Spark token discovery and Arkade
  onboarding surfaced consistently across the wallet.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes and add tests where applicable.
3. Ensure `npm test` passes.
4. Submit a pull request.

## License

MIT License — see [LICENSE](LICENSE).

### Test Bark on mobile

Bark is enabled by default on **signet**. Rebuild the native app after updating;
Expo Go and a JavaScript-only reload cannot add the native SDK.

```bash
pnpm install
EXPO_PUBLIC_BARK=1 EXPO_PUBLIC_BARK_NETWORK=signet pnpm exec expo prebuild --platform android
EXPO_PUBLIC_BARK=1 EXPO_PUBLIC_BARK_NETWORK=signet pnpm android --device
```

On macOS, use `--platform ios` and `pnpm ios --device`. Keep a separate test wallet.

- Open **Dashboard → Bark**, **Receive → Receive on Bark**, or **Settings → Wallet Protocols → Bark**.
- Check the network and connection/recovery status. Bark balances are shown separately
  and excluded from the dashboard total. Signet sats have no fiat valuation.
- Under **Receive on Bark**, choose **Ark** and generate a request. Fund it from
  [Second's signet faucet](https://signet.2nd.dev), then tap **Sync account**.
- **Lightning** requires a positive whole-satoshi amount. **On-chain funding** creates
  a BDK funding address; after confirmation, **Review boarding** explicitly moves
  an entered amount into Bark, with a confirmation prompt and network fees.
- **Send from Bark** opens the normal send flow with Bark selected. Shared `ark1` /
  `tark1` addresses require account selection when opened from the generic send flow;
  Bark and Arkade are separate servers. Check the network on the review screen.
- Pending payments remain pending. For an unknown outcome, sync and check activity
  before retrying. Unknown fees are shown as unavailable.
- Restart the app and sync again to check persistence. Bark activity also appears in
  the shared history with its network label.

`EXPO_PUBLIC_BARK=0` disables Bark. Mainnet requires explicit
`EXPO_PUBLIC_BARK_NETWORK=mainnet`, `EXPO_PUBLIC_BARK_SERVER_URL`, and
`EXPO_PUBLIC_BARK_ESPLORA_URL`; these values are bundled at build time.
Unilateral exit/recovery operations remain library APIs, without dedicated mobile controls.
Native device linking and funded flows must be verified in a development build.
