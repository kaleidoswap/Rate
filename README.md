# KaleidoSwap Wallet

**A non-custodial, multi-protocol Bitcoin wallet with an on-device AI assistant.**

KaleidoSwap is a React Native (Expo) mobile wallet that brings Bitcoin, the Lightning
Network, RGB assets, Liquid, and Bitcoin L2s (Spark, Arkade) together under one
self-custodial roof — driven by a private, **on-device** AI assistant and Nostr social
payments. Your keys, your assets, and your AI all stay on your phone.

---

## Highlights

- 🔑 **Non-custodial & multi-protocol** — one HD wallet (BIP39) across Bitcoin on-chain,
  Lightning, RGB assets, Liquid, Spark, and Arkade.
- 🤖 **On-device AI** — a private assistant (KaleidoMind) that runs the LLM and speech
  models locally; nothing is sent to a cloud LLM by default.
- 🔁 **Atomic swaps** — trustless asset swaps via the KaleidoSwap maker network, plus
  Flashnet AMM pools on Spark.
- 🌐 **Nostr-native** — contacts, Lightning Zaps, Lightning Address, and NWC
  (Nostr Wallet Connect) to pair external apps.
- 🗺️ **Real-world spending** — discover Bitcoin-accepting merchants via BTC Map.
- 🔒 **Hardened by default** — biometric unlock, encrypted SQLite (SQLCipher), and
  keys held in the device secure store.

---

## Supported protocols

KaleidoSwap is built on a shared multi-protocol engine (`@kaleidorg/wallet-engine`)
that routes operations to the active protocol adapter:

| Protocol | What it covers | Backed by |
|---|---|---|
| **Bitcoin / Lightning + RGB** | On-chain BTC, Lightning payments, and RGB asset transfers via an RGB Lightning Node | `kaleido-sdk` (RLN) |
| **Liquid** | Liquid Network assets (L-BTC, issued assets) | `lwk-rn` (native module) |
| **Spark** | Spark L2 Bitcoin + tokens | `@buildonspark/spark-sdk` |
| **Arkade** | Ark VTXOs | `@arkade-os/sdk` |
| **Flashnet** | Spark AMM DEX pools | `@flashnet/sdk` |

Swaps are **KaleidoSwap-first**: the wallet quotes and executes trustless atomic swaps
against the KaleidoSwap maker API, with additional venues for breadth:

- **KaleidoSwap** — maker-based atomic swaps (primary).
- **Flashnet** — Spark AMM DEX pools.
- **Boltz** — submarine swaps between Lightning and on-chain BTC / Liquid.

---

## The AI assistant (KaleidoMind)

The assistant is a natural-language interface to the wallet — ask it to check balances,
create invoices, send payments, swap assets, or find merchants, in chat or by voice.

- **Private by default.** The LLM (QWEN3 ~600M) and Whisper speech-to-text run **on
  device** through the [QVAC SDK](https://www.npmjs.com/package/@qvac/sdk). Conversations
  and transcription don't leave your phone.
- **One agent for chat and voice.** A single runner (`services/mindAgent.ts`) powers both
  text chat and hands-free voice, built on the shared `@kaleidorg/mind` engine.
- **Physical device required.** On-device inference is **not available on a simulator /
  emulator** (the rest of the wallet works fine on one). First launch downloads the
  models (~400 MB LLM + ~40 MB Whisper).
- **Delegate to desktop.** To use the assistant on a simulator — or to offload inference
  — pair the app to a desktop **KaleidoMind provider** over P2P (see
  [AI assistant & voice](#ai-assistant--voice-on-device-vs-delegated)).

---

## Architecture

`index.ts` (polyfills) → `App.tsx` (Redux + PersistGate + Theme + ErrorBoundary) →
`navigation/` (pre-auth setup flow ↔ main tabs + modals).

- **State** — Redux Toolkit + Redux Persist (`store/`).
- **Service layer** (`services/`) keeps screens free of direct SDK calls. At its center is
  **ProtocolManager** (`services/protocols/`), which routes every operation to the active
  protocol adapter (Spark, Arkade, RGB/RLN, Liquid, Flashnet). Alongside it: the
  KaleidoMind agent (`mindAgent.ts` + `*Tools.ts`), on-device AI lifecycle
  (`QVACService.ts`), Nostr + NWC, and biometric auth + encrypted SQLite.
- **Theming** — design tokens in `theme/`, shared UI primitives in `components/`.

> A legacy single-node path (`RGBApiService.ts`, `WalletManager.ts`) is **deprecated**,
> superseded by ProtocolManager.

---

## Tech stack

- **App** — React Native 0.81 + Expo SDK 54 (New Architecture), TypeScript
- **State** — Redux Toolkit, Redux Persist
- **Storage** — `expo-sqlite` with SQLCipher; `expo-secure-store` for keys
- **AI / voice** — `@qvac/sdk` (on-device LLM + Whisper), `@kaleidorg/mind`
- **Wallet engine** — `@kaleidorg/wallet-engine` + protocol SDKs (Spark, Arkade, RGB, Liquid, Flashnet)
- **Nostr** — `@nostr-dev-kit/ndk`, `nostr-tools`
- **Maps** — `react-native-maps` + BTC Map API

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** ≥ 10 (`npm i -g pnpm`). This repo uses pnpm; mixing in `npm install` is not supported.
- **Watchman** (recommended): `brew install watchman`.
- **For iOS:** macOS with **Xcode 16+** (iOS 18 SDK) and **CocoaPods** (`brew install cocoapods`). A **UTF-8 locale** is required (CocoaPods on Ruby 3.4 crashes otherwise).
- **For Android:** **Android Studio** + SDK (API 34+), a configured emulator or a connected device, and **JDK 17**.

> The app uses the **New Architecture** (default on Expo SDK 54) — required by the native `lwk-rn` (Liquid) module.

### Install dependencies

```bash
git clone https://github.com/kaleidoswap/Rate.git
cd Rate
pnpm install        # also runs setup:native → fetches the lwk-rn native artifacts
```

`pnpm install` resolves the multi-protocol stack (Spark, RLN/RGB, Liquid, Arkade). Several
are local `file:` siblings (`../wallet-engine`, `../wdk-wallet-*`, `../arkade-wdk`), so keep
those checked out next to this repo.

> ⚠️ **Do not symlink `node_modules`** (e.g. `ln -s` into another checkout). A self-referencing link causes `ELOOP: too many symbolic links`. If you hit it: `rm node_modules && pnpm install`.

### Native setup (lwk-rn artifacts)

The Liquid protocol uses the `lwk-rn` native module, whose prebuilt native artifacts
(iOS `LwkRnFramework.xcframework` + Android `jniLibs`) are **excluded** from its npm
tarball and normally downloaded by its own `postinstall`. Because pnpm skips
dependency postinstall scripts, a fresh `pnpm install` leaves these artifacts missing,
and the iOS `pod install` / native build then fails on a missing
`LwkRnFramework.xcframework`.

This repo fetches them automatically via `scripts/fetch-lwk-artifacts.sh`, wired into
its own `postinstall`. The step is idempotent (skips when the artifacts already exist)
and non-fatal (warns and continues when offline).

If the iOS build complains about a missing `LwkRnFramework.xcframework` (e.g. because
your package manager skipped postinstall), fetch the artifacts manually:

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
- The **first build is slow** — it compiles the native modules, including `lwk-rn` (Liquid) and the Spark/RGB SDKs.
- `lwk-rn` pins the pod `uniffi-bindgen-react-native` to `0.28.3-3` (already in `package.json`); don't bump it independently or `pod install` will fail with a version conflict.
- If `pod install` crashes with a Ruby `Unicode Normalization … ASCII-8BIT` error, you forgot the `LANG=en_US.UTF-8` export above.
- The **QVAC AI assistant requires a physical device** (no simulator support); the wallet itself runs fine on a simulator.

### Run on Android

```bash
# Have an emulator running (or a device connected — check with `adb devices`), then:
npx expo run:android
```

Notes:
- `lwk-rn` ships prebuilt Android `jniLibs` (arm64-v8a, etc.), fetched automatically during `pnpm install`.
- First build compiles the native modules + Gradle — allow several minutes.

### Run the dev server (after a native build is installed)

Once the app is installed on a simulator/device/emulator, you only need Metro for JS changes:

```bash
npx expo start --dev-client    # then press `i` for iOS or `a` for Android
```

### AI assistant & voice (on-device vs delegated)

The AI assistant and voice mode (speech-to-text + text-to-speech) run **on-device
via the QVAC SDK, which requires a physical device** — they are unavailable on an
iOS simulator / Android emulator. The rest of the wallet works fine on a simulator.

To develop the AI / voice features without a physical device, **delegate inference
to a desktop KaleidoMind provider**:

1. Run the KaleidoMind provider on a desktop (it loads the LLM and, for voice, a
   Whisper STT + Supertonic TTS model, then advertises over P2P).
2. Pair this app to it from the QVAC / KaleidoMind settings (**Pair Desktop** —
   scan the provider's public-key QR).

Chat, transcription, and speech synthesis are then served over P2P by the desktop,
so they work even on a simulator. Toggle delegation off to fall back to on-device
inference (physical device only).

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
- After changing native addons you must **rebuild** the app (`npx expo run:ios/android`);
  a Metro reload alone won't pick them up.
- Models are **not** bundled — they download on first launch on a physical device
  (~400 MB LLM + ~40 MB Whisper). Delegate to a desktop provider to skip the download.
- Agent skills are bundled separately: `pnpm run bundle-skills` regenerates
  `skills.bundle.json` from `skills/`.

---

## Usage

### First-time setup

1. **Create or restore** a wallet (12-word BIP39 recovery phrase).
2. **Secure it** — set a password and enable biometric unlock.
3. **Back up** your recovery phrase offline.
4. **Connect** — the app configures the protocol adapters for your selected network.

### Everyday operations

- **Send / Receive** — across Bitcoin, Lightning, RGB, Liquid, Spark, and Arkade; scan
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

Coverage thresholds (enforced by `jest.config.js`): 70% statements/lines/functions, 60% branches.

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
| iOS build: missing `LwkRnFramework.xcframework` | `pnpm run setup:native` (re-fetches lwk-rn artifacts). |
| `pod install`: `uniffi-bindgen-react-native` version conflict | Keep it pinned to `0.28.3-3` (lwk-rn's podspec requires that exact version). |
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
- **Per-protocol UX maturity** — Liquid asset issuance, Spark token discovery, and Arkade
  onboarding surfaced consistently across the wallet.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes and add tests where applicable.
3. Ensure `npm test` passes.
4. Submit a pull request.

## License

MIT License — see [LICENSE](LICENSE).
