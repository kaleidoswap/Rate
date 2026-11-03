# Unified Swap Android validation

Swap now starts with source/destination asset and network selectors, amount, estimated fees and total. Arkade-to-Lightning review and saved incoming/outgoing receipts stay in the Swap flow. Existing Spark/RGB asset trading remains available through Other wallet assets.

Only Arkade ↔ Lightning routes are executable. Published Bitcoin/Liquid/RGB routes remain blocked until native signing, funding verification and durable recovery are implemented. Catalogue availability alone never enables execution. Review does not authorize payment; the existing explicit payment confirmation remains required.

## Evidence on Bolt, 2026-11-03

The tested QA snapshot passed 284 Jest suites / 2,084 tests, TypeScript, Android Release assembly/signature verification and release bundle auditing (5,548 sources). Release APK SHA256: `b027f330f4b67121c03d325f40914be884d37f6ae019569affcf59243bbc3138`.

Maestro on API 35 verified direct Swap entry, asset/network reversal, estimates, unavailable pair blocking, restoration of the existing unpaid receive and resumption of a completed outgoing receipt. The flow in scripts/arkade-e2e/ui/bolt-unified-swap.yaml requires an already configured test wallet with those saved receipts; it is not a clean-wallet setup flow and does not fund payments.

Earlier Android Release tests settled Lightning → Arkade (11,033 sats paid / 11,000 received) and Arkade → Lightning (10,000 sats received; approved total 10,051), with independent Lightning settlement verification. These funded payments were not repeated on the unified UI APK. Earlier simulator checks covered offline, restart and expired invoice controls.

This PR starts from current main and retains its newer dependency security fixes. The APK above predates that integration; its hash is historical evidence, not an APK built from this PR commit.

## PR integration checks

On the PR source with current main security overrides preserved: frozen-lockfile dependency installation succeeded; 284 suites / 2,084 tests passed with coverage thresholds enforced; TypeScript passed; all 5 dependency security checks passed. Android Release and simulator evidence above belongs to the earlier QA snapshot; a new Release was not assembled from this PR branch.

## Remaining before production

- Funded refund still awaits actual timelocks: absolute earliest 2026-11-04 16:40:06 UTC, also subject to the relative delay of 90,624 seconds. Refund settlement has not been verified. Never refund by changing the clock or repeat funding.
- Native generic maker v2 execution and durable recovery are incomplete and disabled.
- Physical Android hardware, biometrics, camera/QR and push still need validation.
- Release was QA-signed; production signing/distribution is separate.
- iOS is explicitly deferred and no iOS code is changed in this PR.

All builds, artifacts and dependency installs were performed on Bolt. No private wallet material, signing keys, funded-payment replay scripts or generated binaries are included.
