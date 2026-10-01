# KaleidoPay: Rate integration

Entry points: a BOLT12 offer or bitcoin URI containing `lno` scanned or pasted
into Send. Routing is automatic based on the request; there is no separate
KaleidoPay entry in Send. Scanning another request re-evaluates its type.
Legacy BOLT11 scans remain in the existing Send flow.

The screen previews requests, compares live quotes, and executes the explicitly
selected offer after review. It journals the payment before execution and keeps
pending or uncertain outcomes recoverable when the screen is reopened.
Networks are explicitly selected; an address cannot distinguish Signet and
Mutinynet. No connected account is assumed from the global wallet balance.

## Connect the Bark executor

Call `registerKaleidoPayAccount` when the account is connected. Keep and invoke
its returned cleanup function when it disconnects or its network changes.

```ts
const disconnect = registerKaleidoPayAccount({
  source: { id: 'bark-account', rail: `ark:${serverPubkey}`, network: 'signet' },
  swaps: [{ id: 'bark-electrum', from: `ark:${serverPubkey}`, to: 'btc:signet', network: 'signet' }],
  async quote(preview, route) {
    // Resolve and fully validate any BOLT12 offer/invoice, including chain,
    // expiry, amount, signature and destination. Never rely on structural decode.
    // Quote the recipient's exact amount, including Bark, swap and claim costs.
    return { recipientSat, totalSat, feeSat, expiresAt }; // Unix seconds
  },
});
```

Only advertise capabilities the executor actually supports. Offers containing
implicit `ln` are not proof that Bark can pay BOLT12. Direct BOLT12 support needs
an implemented invoice-request flow. Quote callbacks must not pay invoices or
move funds. Provider API calls that create quotes/swaps belong in this callback.

Review again after connecting an account. The UI rejects stale asynchronous
quote responses after edits, rejects inconsistent quote totals, and displays
expiry. The Pay action revalidates the quote and persists a durable attempt before
funding. Expired or refreshed quotes require another review. Request IDs here are local preview identifiers,
not durable payment-attempt identifiers or reusable-offer identities.

## Source packages

The protocol code is not copied here. It comes from the sibling checkout of
[kaleidoswap/universal-bolt12](https://github.com/kaleidoswap/universal-bolt12),
imported from source:

- `@universal-bolt12/universal-code`: payment codes and route planning
- `@universal-bolt12/swap-market`: Electrum swap providers over Nostr (quotes,
  persisted attempts, claim, resume)

Setup, once per machine (clones or updates `../universal-bolt12` and installs
its dependencies):

```bash
pnpm run setup:siblings
```

Metro (`metro.config.js`), TypeScript (`tsconfig.json` paths) and Jest
(`moduleNameMapper`) map the two names to that checkout. Set
`UNIVERSAL_BOLT12_DIR` when it lives elsewhere. A build without the sibling
checkout fails to resolve them; this is a hackathon branch.

## Paying an address from Lightning (Bark)

`createElectrumSwapAccount` in `electrumSwapAccount.ts` is a ready executor for
requests whose accepted rail is `btc:<network>`. Its quote agrees a swap with the
cheapest provider that answers (nothing is paid) and its pay step funds it through
the account's Lightning sender, waits for the provider's lockup and claims to the
requested address.

```ts
import { createElectrumSwapAccount } from './electrumSwapAccount';
import { kaleidoPayStores } from './recovery';

const disconnect = registerKaleidoPayAccount(createElectrumSwapAccount({
  source: { id: 'bark', rail: 'ln', network: 'mainnet' },
  payer: { payInvoices: invoices => bark.payInvoices(invoices) },
  ...kaleidoPayStores,
}));
// Interrupted swaps are resumed on start by <KaleidoPayRecovery /> in App.tsx.
```

`payInvoices` must send all invoices at once and must not wait for the first to
settle: the provider holds the main payment until our claim reveals the preimage
and releases the prepayment only when both arrive. The screen calls `executePaymentOffer` with the exact selected offer after the
user approves. Legacy callers may still use `executePayment` with an approved
quote and an `onUpdate` callback for individual swap stages.

The account implements the pay-flow contract:
`execute(preview, route, quote, attemptId)` starts paying an approved quote and
returns `{ status: 'pending', reference }` once the invoices are on their way
(the screen service claims each attempt durably before execution), and `status(attemptId)` maps the swap stage to
`pending | completed | unknown | failed`, with the claim txid as the reference on
completion. `quoteOptions` exposes up to four provider offers separately, with a 10 s reply budget,
inside the screen's 15 s quote timeout.

Secrets: the preimage and claim key, and the signed claim (its witness carries
the preimage), are kept in SecureStore; the attempt file in the app sandbox holds
only public swap data.

## Checks

`npm test -- --runInBand services/kaleidoPay`

Tests cover routing recognition, fixed request amounts, unavailable accounts,
network isolation, disconnects, quote arithmetic and expiry. No live payments.

## Mobile UI and supported accounts

- Receive keeps QR, requested amount, copy/share and payment status prominent;
  per-method addresses and network controls share one collapsed Payment options
  panel. Lightning expiry comes from the invoice timestamp, never screen age.
- Scan supports camera, clipboard and the system image picker. Camera permission
  is optional for paste/image entry. Leaving the screen invalidates pending reads.
- Pay keeps Edit/Pay actions outside the scrolling review.
- KaleidoPay compares recipient amount, spend asset, fees, total and quote expiry.
  A provider's identity and accepted terms remain fixed through execution. Refresh
  retains the selected provider even if it becomes unavailable. Recommendations
  compare only the same spend asset; token amounts are never compared with sats.
- Connected mobile Spark mainnet accounts expose Bitcoin on-chain withdrawal
  quotes and execute the accepted medium-speed fee quote, without deducting fees
  from the recipient. Other networks and direct BOLT12 execution are not advertised
  by this adapter. Lightning/Electrum accounts require a registered real payer as
  shown above. No example balances or simulated providers are used in the app.
- Pending/unknown payment records block another KaleidoPay payment for that wallet
  until the provider confirms an outcome. The UI never switches providers or
  retries funding automatically. Electrum status recovers the UI-to-swap mapping
  from the persisted attempt; Spark status uses the saved withdrawal reference.
  A lost Spark response before a reference is received remains unknown and needs
  checking against the wallet's activity/provider before any manual resolution.

The image picker adds a native module: reinstall pods and rebuild the development
client before testing image imports. A JavaScript reload alone is insufficient.
Tests use mocked providers; they do not send funds. Live camera, image selection,
provider liquidity and transaction settlement still require device/provider tests.
