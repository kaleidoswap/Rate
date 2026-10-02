# KaleidoPay — bitcoin++ Berlin 2026

One reusable Bitcoin payment QR, with receiver preferences and payer choice.

KaleidoPay is a payment experience inside Rate. Receivers save an ordered list of Bark, Arkade, Lightning and Bitcoin on-chain destinations. An LDK issuer reached through Nostr Wallet Connect creates a reusable BOLT12 offer carrying the requested rails. On-chain addresses travel alongside the offer in BIP321. Payers can review supported routes and quoted providers before confirming a payment.

## Start here

- [Hackathon app source](https://github.com/kaleidoswap/Rate/tree/hack/universal-bolt12)
- [Receiver implementation and verification](./kaleidopay-receiver.md)
- Receiver screen: `screens/MerchantOfferScreen.tsx`
- Payer screen: `screens/KaleidoPayScreen.tsx`
- Receiving services: `services/kaleidoPay/merchantOffer*.ts`

The offer/address extension and custom NWC methods are experimental project interfaces. They are not adopted BOLT12 or NIP-47 standards. Static Ark addresses do not implement negotiated SSPS locks.

## What has been verified

| Evidence | Scope |
| --- | --- |
| Saved preferences, ordering, imported wallet endpoints, QR replacement and receipt handling | Automated Rate tests |
| Amountless offer containing ordered address rails, issued through encrypted NWC; receipt lookup | Real updated LDK instance on isolated regtest, synthetic Ark endpoint |
| Bark ↔ Arkade SDK transfers | Separate mainnet SDK tests; not a complete enriched-QR payment |
| Offer inspector and route walkthrough | Browser-tested local web demo; walkthrough routes are illustrative |
| TypeScript and iOS export | Passed; an export is not a signed distributable app |

A complete mainnet payment through the enriched QR has not been demonstrated. Direct Arkade execution remains dependent on fee-estimation support. Native visual verification of the receiver was blocked by Device Hub access timing out.

## Two-minute demo recording

Record only the steps that are working in the chosen environment. Show the network visibly. Never present a synthetic endpoint or illustrative walkthrough as a paid transaction.

| Time | Show | Narration |
| --- | --- | --- |
| 0:00–0:15 | Landing-page headline | “Bitcoin wallets support different ways to pay. KaleidoPay lets a receiver share one request with their preferred destinations.” |
| 0:15–0:40 | Rate → Receive → Reusable payment QR | “Add a receiving address from a connected wallet, arrange the order, and save those preferences for future offers.” |
| 0:40–1:00 | Create QR through the compatible NWC issuer | “An LDK node creates the BOLT12 offer with those preferences. We verify they survived issuance before saving the QR.” |
| 1:00–1:20 | Inspector showing that public offer | “Bark and Arkade include their server identity and receiving address. Lightning remains available. A Bitcoin address uses BIP321 alongside the offer.” |
| 1:20–1:45 | Rate scan and available route/provider quotes, if connected | “The payer sees supported choices and their total fees. Bark can pay through Lightning or directly to a compatible Bark destination. On-chain receipt can use an Electrum swap.” |
| 1:45–2:00 | Verification summary | “Encrypted enriched-offer issuance is tested on regtest. Separate Bark–Arkade transfers are tested on mainnet. The proposal is one reusable request with explicit receiver preferences and payer choice.” |

If the mobile demo or issuer is unavailable, record the web inspector and label the video **protocol walkthrough**. Do not substitute a mock receipt or claim a live payment occurred. Do not reveal NWC connection secrets, recovery words or wallet configuration during recording.

## Award focus

- **Best use of Bark:** demonstrate Bark performing the payment operation and identify the tested network.
- **Most Based Payment Protocol:** explain the reusable offer, ordered receiver rails, compatibility and explicit payer confirmation.
- Electrum plugin and Mempool accelerator awards require their own implemented plugin/API integration. Electrum swap discovery alone is not a plugin submission.

## Submission readiness

The public app source and these docs are available for judges. Landing page, demo videos and slides: https://kaleidoswap.github.io/kaleido-pay/. Protocol packages: https://github.com/kaleidoswap/kaleido-pay. Do not submit localhost URLs. The protocol packages are public at https://github.com/kaleidoswap/kaleido-pay (formerly universal-bolt12).

Before the live demo, the selected NWC bridge needs the updated rails-capable LDK issuer and `get_info.kaleidopay.rails_versions: [1]`. See the receiver guide for the contract. Do not enable a capability flag on a stock issuer and assume it adds support.
