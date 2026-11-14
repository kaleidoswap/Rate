# BFA Migration Plan — modules/kaleido-rgb

Migrate from RGB-Tools rgb-lib 0.3.0-beta.7 to UTEXO-Protocol's BFA fork
(0.3.0-beta.7-upstream-dev-bfa.8-bfa).

## What BFA adds

**BFA (Bridged Fungible Asset)** — a new RGB schema for bridged fungible
assets (USDT0, bridge smart contracts). The fork adds:

- **VSS backup** — the native VSS server backup replaces the file-only backup
- **Address rotation** — rotate colored/vanilla addresses
- **Multisig online** — goOnline takes `OnlineOptions` + `MultisigOnlineOptions`
- **Optional expiry** — `expirationTimestamp` is now `UInt64?` in blindReceive and send
- **Supply reporting** — `bridgedSupply` / circulating supply for BFA assets
- **Bridge transfers** — consignment posting only from the initiator

## API changes (Swift binding)

| Function | Standard 0.3.0-beta.7 | BFA fork |
|---|---|---|
| `goOnline` | `skipConsistencyCheck, indexerUrl` | `OnlineOptions, MultisigOnlineOptions` |
| `blindReceive` | `expirationTimestamp: UInt64` (required) | `expirationTimestamp: UInt64?` (optional) |
| `send` | `expirationTimestamp: UInt64` (required) | `expirationTimestamp: UInt64?` (optional) |
| `sendBegin` | same | `expirationTimestamp: UInt64?` (optional) |
| `refresh` | `assetId: String?, rlAsInsertionFilter: [UInt32]` | `assetId: String?, filter: [RefreshFilter]` |
| `backupInfo` | absent | `backupInfo() throws -> Bool` |
| `configureVssBackup` | absent | `configureVssBackup(config: VssBackupConfig)` |
| `disableVssAutoBackup` | absent | `disableVssAutoBackup()` |
| `deleteBackup` | absent | `deleteBackup()` |
| `encryptionEnabled` | absent | `encryptionEnabled() -> Bool` |
| `rotateColoredAddress` | absent | `rotateColoredAddress() throws -> String` |
| `rotateVanillaAddress` | absent | `rotateVanillaAddress() throws -> String` |
| `createUtxosEnd` | present | present (same) |
| `sendEnd` / `sendBtcEnd` | present | present (same) |
| `failTransfers` | present | present (signature: `batchTransferIdx: Int32?, noAssetOnly: Bool, skipSync: Bool`) |
| `getLocalLastProcessedOperationIdx` | absent | present |
| `burnInit` | absent | `burnInit(online, assetId, amount, feeRate, minConfirmations) -> InitOperationResult` |

## New types

- `OnlineOptions` — `{ skipConsistencyCheck: Bool, indexerUrl: String, hubUrl: String, hubToken: String }`
- `MultisigOnlineOptions` — for multisig coordination
- `VssBackupConfig` — VSS server configuration
- `RefreshFilter` — structured filter for refresh
- `InitOperationResult` — burn operation result

## Files to update

| File | Change |
|---|---|
| `scripts/download-rgb-lib-ios.js` | URL, SHA-256, version, binding SHA |
| `android/build.gradle` | AAR version → BFA |
| `ios/RgbLib.swift` | Replace with BFA binding + preserve local extensions |
| `ios/KaleidoRgbModule.swift` | Update goOnline, blindReceive, send, add VSS/rotation |
| `ios/Mappers.swift` | Map new types (RefreshFilter, VssBackupConfig, etc.) |
| `ios/DataDirs.swift` | Likely unchanged |
| `src/index.ts` | Expose new capabilities (isVssBackupSupported, etc.) |
| `src/types.ts` | Add new types if the surface changes |

## Binary pins

### iOS (bfa.8 — latest)
- **Version**: `0.3.0-beta.7-upstream-dev-bfa.8-bfa`
- **Repository**: `UTEXO-Protocol/rgb-lib-swift`
- **xcframework SHA-256**: `56edde5c9207548fabbe5944fa8ff81c2b3740c9d85d60f4f63027be969d234a`
- **Source commit**: `cafe66e49d58038a69dd05f8065e3fe96a9d1601`
- **Binding SHA-256** (from fork): `faa8e4b72472cd187a36154229e405cf7bff436e4d335a3b1d8782f347694505`
- **Min iOS**: 16.0

### Android (bfa.6 — latest available)
- **Version**: `0.3.0-beta.7-upstream-dev-bfa.6-bfa`
- **Repository**: `UTEXO-Protocol/rgb-lib-kotlin`
- **AAR**: local file (not on Maven Central)
- **Source commit**: `5010eefa355beb9c42a4c1b69883f7651241a111`
- **Min SDK**: check AAR metadata

⚠️ Android is one BFA release behind (bfa.6 vs bfa.8 iOS). Watch for bfa.8 Android.

## Local additions preserved in the binding

The app's `RgbLib.swift` has these extensions that the upstream/BFA binding
does NOT include (they are local to this repo):

```swift
// 1. ForeignBytes convenience init from UnsafeRawBufferPointer
extension ForeignBytes {
    init(rawBufferPointer: UnsafeRawBufferPointer) { ... }
}

// 2. FfiConverterByRefBytes — a sound scope-bound lower for Data → ForeignBytes
//    (the upstream one is unsafe for zero-copy buffers)
fileprivate enum FfiConverterByRefBytes: FfiConverter { ... }
```

These must be re-added on top of the BFA binding.
