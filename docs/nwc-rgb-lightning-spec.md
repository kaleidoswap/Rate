# RGB Lightning Node — Nostr Wallet Connect Integration

## Overview

Replace direct HTTP REST calls to the RGB Lightning Node with **Nostr Wallet Connect (NIP-47)** as the transport layer. The mobile app becomes a NWC **client**; a lightweight NWC **server** runs alongside the RGB node on the host machine and bridges NWC requests to the node's existing REST API.

This removes the need to expose the node's REST port to the mobile device, works through any Nostr relay, and extends naturally to remote/cloud nodes.

---

## Current vs. Target Architecture

```
CURRENT
  Mobile App
    └── RGBApiService (Axios)
          └── HTTP REST ──────────────────► RGB Node :3001

TARGET
  Mobile App
    └── NWCClientService (NIP-47 client)
          └── NDK ──► Nostr Relay ◄── NDK ──┐
                                             NWC Server (node companion)
                                               └── HTTP REST ──► RGB Node :3001
```

---

## Components

### 1. `NWCClientService` — Mobile Side (new)

A service that speaks NIP-47 as a **client** (wallet user / app). It replaces `RGBApiService` when `nodeType === 'nwc'`.

**Responsibilities:**
- Parse and persist a `nostr+walletconnect://` connection URI
- Encrypt outgoing requests (kind 23194) with the client secret via NIP-04
- Subscribe to encrypted responses (kind 23195) from the wallet pubkey
- Match responses to pending requests by the `e` tag
- Expose async methods that mirror `RGBApiService` so the rest of the app needs minimal changes
- Emit a notification subscription (kind 23196) for push-style events (payment received)

**Core API (mirrors RGBApiService):**
```typescript
class NWCClientService {
  // Connection lifecycle
  connect(connectionString: string): Promise<void>
  disconnect(): void
  isConnected(): boolean

  // Standard NIP-47
  getInfo(): Promise<NodeInfoResponse>
  getBalance(): Promise<BTCBalanceResponse>
  makeInvoice(params): Promise<{ invoice: string; payment_hash: string }>
  payInvoice(invoice: string): Promise<{ preimage: string }>
  lookupInvoice(payment_hash: string): Promise<InvoiceStatus>
  listTransactions(params?): Promise<{ transactions: Transaction[] }>

  // RGB extensions (custom methods, see §Protocol Extensions)
  rgbListAssets(): Promise<ListAssetsResponse>
  rgbGetAddress(): Promise<string>
  rgbBtcBalance(): Promise<BTCBalanceResponse>
  rgbSendBtc(params): Promise<{ txid: string }>
  rgbRgbInvoice(params): Promise<RgbInvoiceResponse>
  rgbSendAsset(params): Promise<{ txid: string }>
  rgbListChannels(): Promise<ListChannelsResponse>
  rgbCreateUtxos(params): Promise<void>
  rgbIssueAsset(params): Promise<IssueNiaAssetResponse>
  rgbDecodeInvoice(invoice: string): Promise<DecodedInvoice>
  rgbInvoiceStatus(invoice: string): Promise<InvoiceStatusResponse>
  rgbConnectPeer(connectionUrl: string): Promise<void>
  rgbSync(): Promise<void>
  rgbUnlockNode(params): Promise<void>

  // Events
  onNotification(callback: (n: NWCNotification) => void): () => void
}
```

**Request/response flow:**
```
sendRequest(method, params)
  1. Generate a random request ID
  2. Encrypt { method, params } with nip04(clientSecret, walletPubkey)
  3. Publish kind 23194 event tagged ['p', walletPubkey]
  4. Await kind 23195 event from walletPubkey where e-tag === request event ID
  5. Decrypt response, resolve/reject Promise
  6. Timeout after 30 s → reject with TIMEOUT error
```

**Key design choices:**
- The client secret (from the connection URI) is the client's private key — persist it in `expo-secure-store`, never in Redux or AsyncStorage
- One NDK instance, shared with `NostrService` if possible, or its own dedicated instance
- Pending requests tracked in a `Map<eventId, { resolve, reject, timeout }>`

---

### 2. NWC Server — Node Companion (new, separate process)

A small Node.js process that runs on the same machine as the RGB node. It listens on Nostr relays for NWC requests and forwards them to the node's REST API.

**Location in repo:** `nwc-server/` (new directory)

**Stack:** Node.js + `@nostr-dev-kit/ndk` + `axios`

**Responsibilities:**
- Generate and persist a stable keypair (the "wallet pubkey" in the connection URI)
- Publish kind 13194 info event listing supported methods
- Subscribe to kind 23194 requests tagged to its pubkey
- Decrypt, route to RGB REST API, encrypt response, publish kind 23195
- Generate connection strings (`nostr+walletconnect://...`) with QR code output for easy mobile pairing
- Optionally push kind 23196 notifications (payment received/sent)

**Configuration (`.env` or CLI args):**
```
RGB_NODE_URL=http://localhost:3001
RELAY_URLS=wss://relay.damus.io,wss://nos.lol
WALLET_PRIVATE_KEY=<hex>   # stable, generated on first run, persisted to .key file
```

**Startup flow:**
1. Load or generate stable keypair → save to `nwc-server/.key`
2. Connect to configured relays
3. Publish info event (kind 13194)
4. Subscribe to requests (kind 23194, `#p: walletPubkey`)
5. For each request: decrypt → call RGB REST → encrypt → publish response
6. On start, print a `nostr+walletconnect://` URI and QR code for pairing

---

### 3. App Integration

#### Settings Slice

Add `'nwc'` as a third `nodeType` and store the connection string:

```typescript
interface SettingsState {
  nodeType: 'remote' | 'local' | 'nwc'   // add 'nwc'
  nwcConnectionString: string             // add field
  // ... existing fields
}
```

The actual client secret inside the connection string must **not** live in the persisted Redux store — strip it before persisting and keep it only in `expo-secure-store`.

#### API Config Middleware

`store/middleware/apiConfigMiddleware.ts` already re-initialises `RGBApiService` on settings changes. Extend it to also initialise/tear-down `NWCClientService` when `nodeType === 'nwc'`.

#### `apiInstance.ts` / Service Factory

Introduce a thin abstraction so the rest of the app calls one unified interface regardless of transport:

```typescript
// services/nodeClient.ts
export function getNodeClient(): RGBApiService | NWCClientService {
  const { nodeType } = store.getState().settings
  return nodeType === 'nwc'
    ? NWCClientService.getInstance()
    : RGBApiService.getInstance()
}
```

Then replace direct `RGBApiService.getInstance()` calls in thunks/screens with `getNodeClient()`.

#### UI — NWC Connection Screen

Add a setup step (or a Settings section) with:
- A QR scanner (using the existing camera permission flow) to scan the `nostr+walletconnect://` URI printed by the NWC server
- Manual paste fallback
- Connection status indicator (relay connected, last heartbeat)
- Disconnect / re-pair button

The easiest place to add this is the existing `WalletSettingsScreen` or as a new step in the node configuration flow.

---

## Protocol Extensions for RGB

NIP-47 defines a fixed set of standard methods. For RGB-specific operations, use custom method names prefixed with `rgb_`:

| Custom Method | Maps to REST endpoint | Params |
|---|---|---|
| `rgb_btc_balance` | `POST /btcbalance` | `{ skip_sync }` |
| `rgb_list_assets` | `POST /listassets` | `{ filter_asset_schemas }` |
| `rgb_address` | `POST /address` | — |
| `rgb_send_btc` | `POST /sendbtc` | `{ address, amount, fee_rate }` |
| `rgb_rgb_invoice` | `POST /rgbinvoice` | `{ asset_id, duration_seconds, min_confirmations }` |
| `rgb_send_asset` | `POST /sendasset` | `{ asset_id, assignment, recipient_id, ... }` |
| `rgb_list_channels` | `GET /listchannels` | — |
| `rgb_create_utxos` | `POST /createutxos` | `{ up_to, num, size, fee_rate, skip_sync }` |
| `rgb_issue_asset_nia` | `POST /issueassetnia` | `{ amounts, ticker, name, precision }` |
| `rgb_decode_ln_invoice` | `POST /decodelninvoice` | `{ invoice }` |
| `rgb_invoice_status` | `POST /invoicestatus` | `{ invoice }` |
| `rgb_connect_peer` | `POST /peers/connect` | `{ peer_pubkey_and_addr }` |
| `rgb_sync` | `POST /sync` | — |
| `rgb_unlock` | `POST /unlock` | `{ password, bitcoind_rpc_*, ... }` |
| `rgb_lsp_info` | `GET /lsp/info` | — |

The NWC server publishes the full list of supported methods (standard + `rgb_*`) in its info event content.

---

## Implementation Plan

### Step 1 — NWC Server (`nwc-server/`)
1. `npm init` + add `@nostr-dev-kit/ndk`, `axios`, `qrcode-terminal`, `dotenv`
2. `keypair.ts` — generate/load stable keypair from `.key` file
3. `handler.ts` — map each NWC method to an RGB REST call
4. `server.ts` — NDK setup, subscribe loop, info event publishing
5. `cli.ts` — print connection URI + QR on startup
6. `README.md` — how to run alongside the RGB node

### Step 2 — `NWCClientService` in Mobile App
1. Create `services/NWCClientService.ts`
   - `connect(uri)`: parse URI, initialise NDK, subscribe to responses
   - `sendRequest(method, params)`: encrypt, publish, await response
   - Implement all standard NIP-47 methods + `rgb_*` extensions
2. Create `services/nodeClient.ts` factory
3. Persist client secret to `expo-secure-store` (key: `nwc_client_secret`)
4. Add `nwcConnectionString` to `settingsSlice` (secret stripped)

### Step 3 — Middleware & Thunks
1. Update `apiConfigMiddleware` to handle `nodeType === 'nwc'`
2. Update all async thunks in `walletSlice`, `assetsSlice`, `nodeSlice`, `transactionsSlice` to use `getNodeClient()` instead of `RGBApiService.getInstance()`

### Step 4 — UI
1. Add NWC pairing screen / settings section
2. QR scan → calls `NWCClientService.connect(uri)` → dispatches `setNodeType('nwc')` + `setNwcConnectionString(stripped)`
3. Add relay connection status to Dashboard or Settings

### Step 5 — Existing `NWCService.ts` (server role in app)
The current `NWCService` runs a NWC *server* inside the mobile app (letting external clients control the wallet). This is a different use-case from what we're building. Decide:
- **Keep as-is** — it exposes the in-app wallet to third-party NWC clients (useful feature)
- **Fix the ephemeral key bug** — the wallet keypair is regenerated randomly on every `initialize()` call; it must be persisted to be useful

---

## Open Questions

1. **Relay choice**: Should the NWC server use public relays or run a local relay (`nostr-relay` / `strfry`) on the same machine for zero-latency, air-gapped operation?
2. **Auth / permissions**: The current `NWCService` has a per-connection permissions list. For the node-side server, a single connection (mobile ↔ node) is likely sufficient; do we need multi-client or expiry-based permissions?
3. **Offline queue**: If the relay is unreachable, should the client queue requests or fail immediately?
4. **`rgb_unlock`**: Sending node credentials (bitcoind RPC password, etc.) over NIP-04 is acceptable for local/trusted relay setups. Flag this for review before mainnet use.
5. **NWC server hosting**: Should the `nwc-server/` companion be a separate npm package, a Docker container, or bundled into the RGB node itself?
