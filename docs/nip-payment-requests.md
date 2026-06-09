# NIP-XX: Payment Requests in Private Direct Messages

`draft` `optional`

This NIP defines **payment requests** and **payment receipts** exchanged inside
[NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) private direct
messages. It lets one user ask another for a Lightning (or RGB-over-Lightning)
payment over a fully encrypted, metadata-private channel, and lets the payer
reply with a verifiable receipt.

It is a thin, backward-compatible layer on top of NIP-17 / NIP-59: a payment
request **is** a `kind:14` chat message, so any NIP-17 client renders it as an
ordinary message containing a payable invoice. Payment-aware clients additionally
parse the tags below to render a rich, stateful card and to correlate receipts.

## Motivation

"Send me 5,000 sats" today means pasting a bare BOLT11 string into a chat. There
is no amount metadata a client can show before decoding, no description, no asset
context for tokenised payments (e.g. RGB assets), and no way to know whether a
request was paid. Carrying this as structured data — while keeping a
human-readable fallback — makes payment requests first-class without sacrificing
interoperability or NIP-17's privacy guarantees.

## Transport

Payment requests and receipts are regular NIP-17 messages:

1. A `kind:14` (chat) **rumor** is built with the tags defined below.
2. It is sealed (`kind:13`) and gift-wrapped (`kind:1059`) per
   [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md), and a gift
   wrap is published to **each recipient and to the sender themselves**.
3. Recipients discover messages by subscribing to `kind:1059` with `#p` set to
   their own pubkey, then unwrap to obtain the rumor.

All NIP-17 privacy properties are inherited: the sender, recipient, timing, and
contents are hidden from relays. `created_at` on the seal and gift wrap MUST be
randomized as NIP-17 requires; ordering uses the **rumor's** `created_at`.

> Clients MAY also carry these structures over a legacy `kind:4` DM
> ([NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md)) when the
> user has selected a legacy scheme, but then only the human-readable content
> (including the invoice) survives — the structured tags are omitted. NIP-17 is
> the RECOMMENDED transport.

## Payment request

A `kind:14` rumor whose `tags` include:

| Tag           | Format                                                            | Req. | Notes |
|---------------|------------------------------------------------------------------|------|-------|
| `payment`     | `["payment", "request", "<request-id>"]`                         | yes  | Marks the message as a request; `<request-id>` is a client-chosen unique string used to correlate the receipt. |
| `bolt11`      | `["bolt11", "<invoice>"]`                                        | yes  | The payable Lightning invoice. For RGB assets this is an RGB-over-Lightning invoice carrying the asset. |
| `amount`      | `["amount", "<msat>"]`                                           | no   | BTC amount in millisatoshis (NIP-57 style). Omit for asset-only requests. |
| `asset`       | `["asset", "<asset_id>", "<ticker>", "<precision>", "<amount>"]` | no   | Present for tokenised (e.g. RGB) requests. `<amount>` is in whole display units. |
| `expiry`      | `["expiry", "<unix-seconds>"]`                                   | no   | When the request/invoice expires. |
| `description` | `["description", "<text>"]`                                      | no   | What the payment is for. |
| `subject`     | `["subject", "Payment request"]`                                | no   | Per NIP-17, lets thread-based UIs title the conversation. |

The `content` field MUST contain a human-readable summary that **includes the
invoice**, so non-aware NIP-17 clients still show something payable, e.g.:

```
⚡ Payment request — 5,000 sats
Coffee
lnbc50u1p...
```

### Example rumor (pre-seal)

```jsonc
{
  "kind": 14,
  "created_at": 1700000000,
  "content": "⚡ Payment request — 5,000 sats\nCoffee\nlnbc50u1p...",
  "tags": [
    ["p", "<recipient-pubkey>"],
    ["payment", "request", "a1b2c3d4"],
    ["bolt11", "lnbc50u1p..."],
    ["subject", "Payment request"],
    ["amount", "5000000"],
    ["expiry", "1700003600"],
    ["description", "Coffee"]
  ]
}
```

An RGB-asset request replaces/accompanies `amount` with:

```jsonc
["asset", "rgb:2DXRtmos-...", "USDT", "6", "5"]
```

## Payment receipt

After paying (or declining), the payer SHOULD reply with a `kind:14` rumor:

| Tag        | Format                                       | Req. | Notes |
|------------|----------------------------------------------|------|-------|
| `payment`  | `["payment", "receipt", "<request-id>"]`     | yes  | Correlates to the request's `<request-id>`. |
| `status`   | `["status", "paid" \| "declined" \| "expired"]` | yes  | Outcome. |
| `preimage` | `["preimage", "<hex>"]`                       | no   | Payment preimage as proof, when available. |

`content` carries a human-readable fallback (e.g. `✅ Paid`). A client marks a
request as settled when it observes a `receipt` with `status: paid` and a
matching `request-id` (or when it paid the invoice locally).

## Client behaviour

- The **requester** displays a request card (amount, asset, description,
  expiry) and updates it to "Paid" when a matching receipt arrives.
- The **payer** displays a request card with a **Pay** button; on success it
  pays the `bolt11` invoice (which already encodes the amount) and emits a
  `paid` receipt.
- A request whose `expiry` has passed MUST NOT offer a Pay action.
- Clients MUST NOT trust a `preimage` blindly for high-value settlement; verify
  it against the invoice's payment hash when settlement finality matters.

## Privacy & security

- Inherits NIP-17/NIP-59: relays learn neither the parties nor the contents.
- The `request-id` is opaque and SHOULD be unguessable; it correlates a
  request and its receipt within an already-private conversation.
- The invoice still uniquely identifies a payment on the Lightning network;
  this NIP does not change Lightning's own privacy characteristics.

## Rationale

Reusing `kind:14` (rather than a new dedicated kind) maximises interop: existing
NIP-17 clients degrade gracefully to a readable, payable message. The tag names
mirror existing conventions where possible (`bolt11`, `amount` in msat as in
NIP-57; `subject` as in NIP-17). A future revision MAY define a dedicated kind if
richer, non-degradable semantics are required.

---

*Status: vendor draft authored for KaleidoSwap, intended for upstream proposal.
Implemented in this app via `services/NostrService.ts`
(`sendPaymentRequest` / `sendPaymentReceipt`) and `screens/ChatScreen.tsx`.*
