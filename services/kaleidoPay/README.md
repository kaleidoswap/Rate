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

## Source package

`universalCode/` is a vendored TypeScript snapshot of
`universal-bolt12/packages/universal-code/src/`, copied 2026-10-01. This follows
this hackathon checkout's existing `services/swapMarket/` pattern and avoids
introducing a sibling-path dependency that breaks a standalone checkout. Update
all five files together from the package; do not fork the protocol locally.
It uses dependencies already declared by Rate. See the source package README
for the codec's intentionally limited validation and BIP321 subset.

## Checks

`npm test -- --runInBand services/kaleidoPay/index.test.ts`

Tests cover routing recognition, fixed request amounts, unavailable accounts,
network isolation, disconnects, quote arithmetic and expiry. No live payments.
