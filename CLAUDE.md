# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
expo start              # Start Expo dev server
expo run:ios            # Run on iOS simulator
expo run:android        # Run on Android emulator

# Testing
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Run tests with coverage report

# Run a single test file
npx jest path/to/file.test.ts
```

Coverage thresholds: 70% statements/lines/functions, 60% branches (enforced by jest.config.js).

## Architecture

**KaleidoSwap Wallet** (codename `rate`) is a non-custodial Bitcoin & RGB asset wallet built with React Native (Expo). It supports Lightning Network, atomic swaps (Kaleidoswap), Nostr social features, and an AI assistant.

### Entry Flow

`index.ts` → polyfills (Buffer, crypto) → `App.tsx` → Redux Provider + PersistGate + ThemeProvider + ErrorBoundary → `navigation/index.tsx`

Navigation has two modes: pre-auth screens (wallet setup/restore) and the main app with bottom tabs (Dashboard, Contacts, Scan, Map, AI Chat) plus modal screens.

### State Management (Redux Toolkit + Redux Persist)

9 slices in `store/slices/`:
- **walletSlice** – active wallet, BTC balance, Bitcoin price, wallet list
- **nodeSlice** – RGB/Lightning node status
- **assetsSlice** – RGB assets with balances
- **transactionsSlice** – transaction history
- **settingsSlice** – network config, node URL, preferences
- **uiSlice** – modal states, loading flags, toast notifications
- **contactsSlice** – local contacts
- **swapSlice** – atomic swap orders
- **nostrSlice** – Nostr profile, contacts, messages

Persisted slices: `settings`, `ui`, `contacts`, `nostr`. Blacklisted (not persisted): `wallet`, `node`, `assets`, `transactions`, `swap`.

Always use the typed hooks from `store/hooks.ts`: `useAppDispatch()`, `useAppSelector()`, and domain selectors like `useWallet()`, `useSettings()`, `useAssetActions()`, etc.

### Service Layer

`services/` contains all business logic, keeping screens/components free of direct API calls:
- `protocols/index.ts` – **ProtocolManager** singleton from `@kaleidorg/wallet-engine` shared lib; adapters for Spark, Arkade, RGB (kaleido-sdk). Entry point: `protocolManager`
- `RGBApiService.ts` – **DEPRECATED** legacy RGB node REST API (being replaced by ProtocolManager)
- `WalletManager.ts` – **DEPRECATED** thin facade over ProtocolManager
- `DatabaseService.ts` – SQLite (expo-sqlite) with SQLCipher encryption
- `NostrService.ts` / `NWCService.ts` – Nostr protocol + NIP-47 Wallet Connect
- `SecurityService.ts` – biometric auth, SecureStore encryption
- `QVACService.ts` – on-device AI model lifecycle (LLM + Whisper via @qvac/sdk)
- `mindAgent.ts` – the ONE KaleidoMind agent runner (fast-path → recipe → agentic funnel) shared by chat and voice; `walletTools.ts` / `merchantTools.ts` / `aiMemory.ts` / `aiKnowledge.ts` are its tool-source bindings

### Protocol Layer (shared library)

The app uses `@kaleidorg/wallet-engine` (at `../wallet-engine/`) for multi-protocol wallet support:
- **SparkAdapter** – `@buildonspark/spark-sdk` (Spark L2 Bitcoin)
- **ArkadeAdapter** – `@arkade-os/sdk` with Expo providers (Arkade VTXOs)
- **RgbAdapter** – `kaleido-sdk` for RGB Lightning node + KaleidoSwap maker API
- **FlashnetClientManager** – `@flashnet/sdk` for Spark DEX swaps (piggybacks on SparkWallet)
- **ProtocolManager** – central orchestrator, routes operations to active adapter

Utility files:
- `hooks/useProtocol.ts` – React hooks: `useProtocolManager()`, `useActiveProtocol()`, `useProtocolStatus()`
- `utils/account-routing.ts` – asset family classification, route resolution, destination detection
- `utils/swap-model.ts` – swap pair management, venue detection (KaleidoSwap vs Flashnet), HTLC capacity

### Theming

`theme/index.ts` exports design tokens (colors, typography, spacing) — do not hardcode colors or spacing. Most screens `import { theme }` (the static **dark** theme; dark is the brand default). A context path also exists (`useAppTheme()` from `theme/ThemeProvider.tsx`) but is not yet used app-wide.

**Dark-only for now.** Because screens import the static dark `theme`, a Light/System toggle has no visible effect, so the Settings theme picker is intentionally omitted. `lightTheme` and the `useAppTheme()` path are kept for a future migration — to make light mode real, screens must consume `useAppTheme()` instead of the static import.

Token helpers in `theme/index.ts`:
- `protocolColor(p)` / `protocolTint(p, alpha)` — per-protocol accents (`theme.colors.protocol`). Never re-hardcode protocol hexes.
- `theme.colors.networks` — per-network "leg" colors for Send/Receive destination coding (shared so the two screens can't drift). `theme.colors.brand.violet` is the secondary brand accent.
- `leading(fontSize, multiplier)` — convert a `typography.lineHeight` multiplier to the absolute px RN needs (the raw `lineHeight` tokens are CSS-style multipliers and are NOT usable directly).

Shared UI primitives live in `components/` and are exported from `components/index.ts`: `Button`, `Card`, `Input`, `Badge`, `SegmentedTabs`, `CopyButton`, `SectionHeader`, `Divider`, `Callout`, `AmountText` (tabular-nums for balances/amounts), `EmptyState`. Prefer these over hand-rolling pills/tabs/dividers/copy affordances.

### Key Patterns

- Async operations use Redux Toolkit `createAsyncThunk`; dispatch thunks from screens via action hooks
- `metro.config.js` includes Node.js polyfills (crypto, stream, buffer) required for Bitcoin libs
- Multi-protocol wallet via `protocolManager` (Spark, Arkade, RGB); screens use `protocolManager.getAdapter('PROTOCOL')` with legacy `RGBApiService` fallback
- RGB Lightning node accessed via kaleido-sdk through the shared `@kaleidorg/wallet-engine` library
- Swaps support two venues: KaleidoSwap (maker-based atomic swaps) and Flashnet (Spark AMM pools)
- AI assistant uses QVAC SDK for on-device LLM (QWEN3 600M) and Whisper transcription, driven through the shared `@kaleidorg/mind` engine — see `services/mindAgent.ts` (single runner for chat + voice), `services/QVACService.ts` (model lifecycle), and `services/walletTools.ts` (wallet tool contract binding, unit-tested in `walletTools.test.ts`)
- Voice input uses `components/VoiceInput.tsx` (QVAC Whisper) instead of WebView-based speech recognition
- QVAC models require physical devices (no emulator support); first launch downloads models (~400MB LLM + ~40MB Whisper)
- Sensitive keys use `expo-secure-store`; environment variables via `react-native-dotenv` from `.env`
