# Rate BFA test build

The `test/rgb-bfa8-native` branch builds Rate BFA Test. Its app identifier is
`com.kaleidoswap.wallet.bfatest`. The RGB account uses Mutinynet and the
Iris proxy protocol 1.0 endpoint. Use a fresh test wallet or a copy of a test
fixture. Keep the original fixture available for comparison.

The [BFA native test workflow](https://github.com/kaleidoswap/Rate/actions/workflows/bfa-native-test.yml)
provides an Android arm64 APK and an iOS arm64 Simulator app. Both use the
UTEXO native `0.3.0-beta.7-upstream-dev-bfa.8-bfa` bindings and binaries from
commit `cafe66e49d58038a69dd05f8065e3fe96a9d1601`.

## Interoperability checks

1. Confirm the browser test build uses `@utexo/rgb-lib-wasm@1.0.0-beta.4`.
   Create a fresh Mutinynet browser wallet and use proxy protocol 1.0.
2. With test sats available for network fees and a test BFA contract, send a
   small allocation from the browser to a new mobile invoice. Confirm the
   contract ID, amount and settled state on both sides.
   If the contract history includes a bridged mint, configure the trusted EVM
   RPC and mint lock bounds for that test chain in both clients before
   attempting validation.
3. Send a portion back to a fresh browser invoice. Confirm the two settled
   balances and check the mobile apps on both platforms.
4. Reopen each mobile test wallet and compare balances and transfer history.
   Import an encrypted backup from a copy of a legacy Mutinynet wallet into
   the isolated app and compare network, asset IDs, balances and history
   against that fixture.

Record only public transaction IDs, contract IDs and observed states. The
browser WASM release requires a new browser wallet when moving from beta.3
to beta.4. [WASM release notes](https://github.com/UTEXO-Protocol/rgb-lib-wasm/releases/tag/v1.0.0-beta.4)
