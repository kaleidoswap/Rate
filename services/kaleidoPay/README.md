# KaleidoPay: Rate integration

Entry points: Send → Open KaleidoPay; a BOLT12 offer or bitcoin URI containing
`lno` pasted into Send; QR scanner; KaleidoPay's own scan/paste controls.
Legacy BOLT11 scans remain in the existing Send flow.

The screen previews requests and requests quotes. It does not execute payments.
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
expiry. The later Pay action must revalidate the quote, get approval and persist
recovery material before funding. Request IDs here are local preview identifiers,
not durable payment-attempt identifiers or reusable-offer identities.

## Source packages

The protocol code is not copied here. It comes from the sibling checkout of
[kaleidoswap/universal-bolt12](https://github.com/kaleidoswap/universal-bolt12),
imported from source:

- `@universal-bolt12/universal-code`: payment codes and route planning
- `@universal-bolt12/swap-market`: Electrum swap providers over Nostr (quotes,
  persisted attempts, claim, resume)

Setup, once per machine:

```bash
git clone https://github.com/kaleidoswap/universal-bolt12 ../universal-bolt12
(cd ../universal-bolt12 && npm install)
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
import { createElectrumSwapAccount, resumeKaleidoPaySwaps } from './electrumSwapAccount';
import { createAttemptStore, secureSecretStore } from './storage';

const attempts = createAttemptStore();
const disconnect = registerKaleidoPayAccount(createElectrumSwapAccount({
  source: { id: 'bark', rail: 'ln', network: 'mainnet' },
  payer: { payInvoices: invoices => bark.payInvoices(invoices) },
  attempts,
  secrets: secureSecretStore,
}));
// On app start, after the payer is available:
await resumeKaleidoPaySwaps({ attempts, secrets: secureSecretStore });
```

`payInvoices` must send all invoices at once and must not wait for the first to
settle: the provider holds the main payment until our claim reveals the preimage
and releases the prepayment only when both arrive. The screen then calls
`executePayment(preview, quote, onUpdate)` after the user approves; `onUpdate`
receives each stage (`paying`, `waiting_lockup`, `lockup_seen`, `claiming`,
`claimed`, or `recoverable`/`failed` with an error).

The account also implements the pay-flow contract from `codex/payment-experience`:
`execute(preview, route, quote, attemptId)` starts paying an approved quote and
returns `{ status: 'pending', reference }` once the invoices are on their way
(it is idempotent per `attemptId`), and `status(attemptId)` maps the swap stage to
`pending | completed | unknown | failed`, with the claim txid as the reference on
completion. Quotes ask up to four providers in parallel with a 10 s reply budget,
inside the screen's 15 s quote timeout.

Secrets: the preimage and claim key, and the signed claim (its witness carries
the preimage), are kept in SecureStore; the attempt file in the app sandbox holds
only public swap data.

## Checks

`npm test -- --runInBand services/kaleidoPay`

Tests cover routing recognition, fixed request amounts, unavailable accounts,
network isolation, disconnects, quote arithmetic and expiry. No live payments.
