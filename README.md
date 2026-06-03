# KaleidoSwap Wallet — Smart RGB Lightning Wallet

A next-generation non-custodial mobile wallet that integrates RGB assets, Lightning Network, AI assistance, and social features into a unified Bitcoin experience.

## Overview

KaleidoSwap is a React Native mobile application that provides a complete self-custodial wallet solution for Bitcoin and RGB assets. The wallet features an embedded RGB Lightning Node, AI-powered natural language interface, Nostr social integration, and local business discovery through BTC Map integration.

## Key Features

### 💰 **Wallet Core**
- **Non-custodial**: Users control their private keys
- **Multi-asset support**: Bitcoin and RGB assets (stablecoins, tokens, NFTs)
- **Lightning Network**: Fast, low-cost payments
- **On-chain transactions**: Full Bitcoin blockchain support
- **HD wallet**: BIP39 mnemonic seed phrase backup

### 🤖 **AI Assistant**
- **Natural language interface**: Control wallet with voice or text
- **Smart commands**: "Send 100,000 sats to Alice" or "Create invoice for $50"
- **MCP server integration**: Direct AI-to-wallet communication
- **Location services**: Find Bitcoin-accepting businesses with AI

### 🌐 **Social Features (Nostr)**
- **Contact management**: Sync contacts via Nostr protocol
- **Lightning Zaps**: Social micropayments
- **Lightning Address**: Send to username@domain.com
- **Wallet Connect**: Connect to external applications
- **Social payments**: Pay friends directly from contact list

### 🗺️ **Local Discovery**
- **BTC Map integration**: Find nearby Bitcoin merchants
- **Real-world utility**: Bridge digital assets to physical commerce
- **Merchant payments**: Direct payments to discovered businesses
- **Stablecoin support**: Spend RGB stablecoins locally

### ⚡ **Advanced Features**
- **Atomic swaps**: Exchange assets via Kaleidoswap integration
- **LSP integration**: Automated Lightning liquidity management
- **QR code support**: Scan Bitcoin addresses, Lightning invoices, RGB invoices
- **Biometric security**: Face ID, Touch ID, Fingerprint authentication

## Technology Stack

- **Frontend**: React Native with Expo
- **State Management**: Redux Toolkit
- **Database**: SQLite with SQLCipher encryption
- **Security**: Expo SecureStore, biometric authentication
- **AI**: OpenAI GPT integration with custom MCP server
- **Bitcoin/RGB**: Embedded RGB Lightning Node binary
- **Nostr**: NDK (Nostr Development Kit)
- **Maps**: BTC Map API integration

## Architecture

### Node Options
- **Local Mode**: RGB Lightning Node runs as embedded binary in the app
- **Cloud Mode**: Connect to remote Thunderstack nodes for demo/production

### Security
- Hardware security module integration
- Multi-layer encryption (SQLCipher + AES)
- Secure key derivation and storage
- Background app protection

## Quick Start

### Prerequisites

- **Node.js** ≥ 20 and **pnpm** ≥ 10 (`npm i -g pnpm`). This repo uses pnpm; mixing in `npm install` is not supported.
- **Watchman** (recommended): `brew install watchman`.
- **For iOS:** macOS with **Xcode 16+** (iOS 18 SDK) and **CocoaPods** (`brew install cocoapods`). A **UTF-8 locale** is required (CocoaPods on Ruby 3.4 crashes otherwise).
- **For Android:** **Android Studio** + SDK (API 34+), a configured emulator or a connected device, and **JDK 17**.

> The app uses the **New Architecture** (default on Expo SDK 54) — required by the native `lwk-rn` (Liquid) module.

### Install dependencies

```bash
git clone https://github.com/kaleidoswap/rate.git
cd rate
pnpm install        # also runs setup:native → fetches the lwk-rn native artifacts
```

`pnpm install` resolves the WDK protocol stack (Spark, RLN/RGB, Liquid, Arkade) — several of these are local `file:` siblings (`../wallet-protocols`, `../wdk-wallet-*`, `../arkade-wdk`), so keep those checked out next to this repo.

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

### Development Setup

For detailed development setup including RGB node compilation and Bitcoin node configuration, see [TECHNICAL_SETUP.md](TECHNICAL_SETUP.md).

### Demo Mode

The app comes pre-configured to work with Thunderstack demo nodes - no additional setup required for testing.

## Usage

### First Time Setup

1. **Create Wallet**: Generate new wallet or restore from backup
2. **Secure Wallet**: Set password and enable biometric authentication
3. **Backup Phrase**: Securely store your 12-word recovery phrase
4. **Configure Node**: Choose local or cloud node connection

### Basic Operations

#### Send Bitcoin/RGB Assets
```
1. Tap "Send" on dashboard
2. Select asset type (Bitcoin/RGB)
3. Enter amount and recipient
4. Confirm transaction
```

#### AI Commands
```
Voice: "Send 50,000 sats to John"
Text: "Create an invoice for $25"
Location: "Find coffee shops that accept Bitcoin"
```

#### Social Payments
```
1. Go to Contacts (Nostr)
2. Select friend
3. Tap "Zap" for Lightning payment
4. Enter amount and send
```

### Asset Management

- **View Balances**: Dashboard shows all Bitcoin and RGB assets
- **Transaction History**: Complete history with transaction details
- **Asset Details**: Detailed information for each RGB asset
- **Atomic Swaps**: Exchange assets through integrated DEX

## API Integration

### AI Service
The wallet integrates with OpenAI GPT through a custom MCP (Model Context Protocol) server that provides secure access to wallet functions.

### Nostr Integration
Uses NDK for Nostr protocol integration, enabling social features and wallet connect functionality.

### BTC Map API
Integrates with BTC Map to discover local Bitcoin-accepting merchants and enable location-based payments.

## Security Considerations

### Key Management
- Private keys never leave the device
- Hardware security module integration
- Secure enclave storage on supported devices

### Data Protection
- SQLCipher database encryption
- AES encryption for sensitive data
- TLS/SSL for network communications

### Authentication
- Biometric authentication (Face ID, Touch ID, Fingerprint)
- PIN protection with attempt limiting
- Session management with automatic locks

## Development

### Project Structure
```
rate/
├── screens/          # React Native screens
├── services/         # Business logic and API integrations
├── store/           # Redux state management
├── components/      # Reusable UI components
├── navigation/      # Navigation configuration
├── utils/          # Helper functions
├── types/          # TypeScript definitions
└── assets/         # Static assets and RGB node binary
```

### Building

This is a **prebuilt** Expo project (it has `ios/` and `android/` directories), so use `expo run:*`, not `expo start --ios/--android`.

#### Development
```bash
# First build (compiles native code) — see "Run on iOS" / "Run on Android" above:
npx expo run:ios          # iOS simulator/device
npx expo run:android      # Android emulator/device

# Subsequent JS-only changes just need Metro:
npx expo start --dev-client
```

#### Production
```bash
eas build --platform ios
eas build --platform android
```

### Troubleshooting

| Symptom | Fix |
|---|---|
| `ELOOP: too many symbolic links … node_modules` | A self-referencing `node_modules` symlink. `rm node_modules && pnpm install`. |
| iOS `pod install` → `Unicode Normalization … ASCII-8BIT` | `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before running. |
| iOS build: missing `LwkRnFramework.xcframework` | `pnpm run setup:native` (re-fetches lwk-rn artifacts). |
| `pod install`: `uniffi-bindgen-react-native` version conflict | Keep it pinned to `0.28.3-3` (lwk-rn's podspec requires that exact version). |
| `npx expo` prompts to install a different Expo version | `node_modules` is broken — reinstall so the local `expo` is used. |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: See [TECHNICAL_SETUP.md](TECHNICAL_SETUP.md) for detailed setup
- **Issues**: Report bugs via GitHub Issues

## Roadmap

- [x] Core wallet functionality
- [x] AI assistant integration
- [x] Nostr social features
- [x] BTC Map integration
- [ ] Enhanced AI capabilities
- [ ] Plugin architecture
- [ ] Multi-language support
- [ ] Hardware wallet integration

---

*KaleidoSwap Wallet: Making Bitcoin and RGB assets accessible through conversational AI and social integration.*