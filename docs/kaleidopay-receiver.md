# KaleidoPay receiver delivery

Receive → Reusable payment QR lets the receiver add Bark, Arkade and Bitcoin on-chain destinations, reorder them with accessible up/down controls and save preferences per NWC connection and network. Lightning remains in the list. Connected Ark wallets can supply their native receive address and server key; importing checks network and server identity before and after address generation. Public endpoints can also be entered manually and require validation by the payer SDK.

Preferences and the issued QR are saved separately. Saving defaults never changes an existing offer. Creating an updated QR keeps the old QR visible until issuance and persistence succeed; retrying a failed local save reuses the pending offer during this screen session. Previously shared offers are not revoked. NWC receipts cover Lightning payments only; direct payments belong to the Ark wallet's history.

The receiver uses the current shared `ssps_rails` format, not the removed destination TLV. `kaleidopay_make_offer` receives `{description, amount?, rails?}` (amount in msat), with string rails or `{rail: 'bark|arkade:<x-only server key>', address}` entries. The returned offer is checked for exact ordered rails, Bitcoin amount and network before storage. Network detection cannot identify a custom signet without a distinguishing rail. Regtest keeps the legacy Lightning-only path.

For an on-chain destination, the QR/share value is BIP321 containing the Bitcoin address, optional amount and original offer. It is not an SSPS lock. Without an on-chain destination, the QR is the original BOLT12 offer.

## Issuer requirements

The bridge must advertise `get_info.kaleidopay.rails_versions: [1]`. The receiver blocks enriched issuance without it. In `ldk-test-env/nwc-bridge`, set both `NWC_BOLT12_RECEIVE=true` and `NWC_SSPS_RAILS=true` with the updated LDK fork supporting object entries and amountless `--ssps-rails` offers. The bridge verifies the exact canonical record before returning it. A stock or old node cannot be upgraded by enabling the flag.

No changes are made to a running issuer, native wallet keys or the payer track by this receiver change. Live encrypted-NWC checks passed against the stock regtest node for legacy offers and against a separate updated regtest node for amountless offers with ordered address rails. The enriched check uses a synthetic Ark endpoint and verifies issuance/receipt lookup, not direct Ark payment. Deploy the updated issuer and bridge behind the selected NWC connection for the real demo.

## Verification

Tests cover order persistence and connection/network isolation; SDK address import and wallet changes; capability checks; missing/reordered rails; altered encoded amounts; QR replacement with storage failure; BIP321 composition; legacy offers; and receipt lookup. TypeScript and an iOS bundle export are also checked. Native visual inspection depends on access to Device Hub.

Final validation: 583 Rate tests in 88 suites, TypeScript check and iOS export passed. Native visual inspection was unavailable because Device Hub timed out.
