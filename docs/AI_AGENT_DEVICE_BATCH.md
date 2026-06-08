# AI agent — on-device implementation batch

The pure-TS recipe/contract work is done (receive, asset-send, disambiguation,
swap routing). These four touch live device surfaces (Nostr relays, the maker/
Flashnet swap engine, the confirm UI) and must be wired + tested on a phone.
Each item lists the exact files, methods, and a device test.

All wallet tools live in `services/walletTools.ts` (the contract handlers);
recipes are registered in `services/mindAgent.ts` (voice) and
`screens/AIAssistantScreen.tsx` (chat).

---

## #38 — Send to a Nostr account / contact (the "not working" one)

**Goal:** "pay alice 5k", "send 10k to npub1…/alice@domain" resolves to a payable
Lightning address.

**Where:** `resolve_contact` handler in `services/walletTools.ts`.

**Today:** only reads the local `contacts.contacts` slice for `lightning_address`.
A contact stored as a Nostr follow (with a `pubkey`/`npub` but no `lightning_address`)
returns nothing → the send fails.

**Wire (`NostrService` already has the pieces):**
1. In `resolve_contact`, after the local-contact lookup, if the match has a
   `pubkey`/`npub` but no `lightning_address`, fetch the profile:
   - `NostrService.getUserInfo(pubkey)` → `{ profile, npub }`; use `profile.lud16`
     (the Lightning address) — see `NostrService.ts:398 getUserProfile` /
     `:693 getUserInfo`, profile shape has `lud16` (`:51`).
2. If the user typed a raw `npub1…`: `nip19.decode(npub)` → pubkey → `getUserInfo`
   → `profile.lud16`.
3. If they typed a `name@domain` nip-05: resolve nip-05 → pubkey (NDK
   `getUserFromNip05`/`nip05.queryProfile`) → `profile.lud16`.
4. Return `{ name, ln_address: lud16, npub }`. The payments recipe's existing
   LNURL step (already in `walletTools` `resolveLightningAddress`) then pays it.

**Device test:** add a Nostr contact whose profile has a Lightning address →
"pay <name> 1000 sats" → confirm sheet → sent.

---

## #39 — Swap execution (quote + atomic execute)

**Goal:** "buy 0.001 BTC with USDT" / "swap 10 USDT for BTC" actually quotes +
executes (today `get_swap_quote` only routes to the Swap screen).

**Where:** `get_swap_quote` + `execute_swap` in `services/walletTools.ts`;
register `swapRecipe` in both agents (currently only chat/voice have payments/
receive/asset-send).

**Venues (per design):** **Flashnet on Spark · KaleidoSwap maker on RLN.**
Mirror `screens/SwapScreen.tsx`:
- Clients: `kaleidoClientManager`, `flashnetClientManager` (from `services/protocols`).
- Pairs: maker pairs + `flashnetClientManager.getClient().listPools({sort:'TVL_DESC'})`
  → `buildFlashnetPairs` (`SwapScreen.tsx:182`).
- Venue detect: `isFlashnetPair` / `swap-model.ts` (`venue: 'kaleidoswap' | 'flashnet'`).
1. **`get_swap_quote`**: pick the pair for {from,to}; if Flashnet → Flashnet
   client quote; if maker → `RgbAdapter.getQuote(...)`. Return rate + a `quote_id`.
2. **`execute_swap`** (🔒 spend): Flashnet → the Flashnet swap call; KaleidoSwap →
   the atomic flow (`atomicInit → atomicTaker → atomicExecute`, see the
   `SwapProgress` states in `swap-model.ts`). Keep the confirm gate.
3. Register `swapRecipe` (import from `@kaleidorg/mind`) in the RecipeRegistry in
   `mindAgent.ts` + `AIAssistantScreen.tsx`.

**Risk:** money-critical + multi-step atomic flow — test small amounts on signet
first. Alternatively keep the screen-handoff for execute and only wire the live
quote in-chat.

**Device test:** "swap 1 USDT for BTC" → live rate → confirm → atomic swap completes.

---

## #40 — Share an invoice to a contact (Nostr DM)

**Goal:** "create an invoice for 5000 sats and send it to alice" → make the
invoice, then DM it to the contact.

**Where:** new `share_to_contact` (or `send_message`) tool in `walletTools.ts` +
a follow-up step in the receive recipe (or a small dedicated recipe).

**Wire:**
1. Add a `NostrService` DM method if missing (NIP-04 or NIP-17): encrypt + publish
   a kind-4/kind-14 event to the contact's pubkey. (`NostrService` has the NDK
   user + relays; check for an existing send-DM helper first.)
2. Tool `share_to_contact({ to, text })`: resolve the contact's pubkey → send the
   DM. Confirmation-gated (it leaves the device).
3. Recipe step after `create_invoice`: if the request names a recipient, DM the
   returned `invoice`/`address`.

**Device test:** "invoice 5000 sats for alice" → invoice created → alice receives
a DM with it.

---

## #41 — Confirm-sheet clarity (the disambiguation half is done)

**Goal:** before any send, the sheet shows **recipient · amount · asset · rail**.

**Where:** `buildPaymentDetails` + `PaymentDetails` type + `PaymentConfirmationModal`
in `screens/AIAssistantScreen.tsx` / `components/PaymentConfirmationModal.tsx`.

**Wire:**
1. Extend `PaymentDetails` (`:79`) with `asset?`, `layer?`, `amountDisplay?`.
2. In `buildPaymentDetails`, read the tool call: for `send_payment` show sats +
   destination; for `rln_send_asset` show `{amount} {asset}`; for `execute_swap`
   show `{from}→{to}`. Pick the rail from the chosen tool/layer.
3. Render those fields in `PaymentConfirmationModal`.

**Device test:** each of "pay bob 5k", "send 10 USDT to bob", "swap 1 USDT for
BTC" shows a clear, correct review sheet before sending.

---

## Suggested order
#38 (unblocks the core "send to a friend" flow) → #41 UI (safety, every send) →
#40 (nice demo) → #39 execution (most complex, test on signet last).
