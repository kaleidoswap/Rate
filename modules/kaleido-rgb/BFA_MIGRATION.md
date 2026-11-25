# Rate 0.19 RGB upgrade

Rate 0.19 uses the UTEXO native `0.3.0-beta.7-upstream-dev-bfa.8-bfa`
release on both Android and iOS. It shares the RGB `0.11.2-rc.1` core used by
WASM `1.0.0-beta.4`. Source commit `cafe66e49d58038a69dd05f8065e3fe96a9d1601`.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for artifact provenance.

TestFlight users can open **Settings → Advanced → Accounts & networks → RGB →
This phone**, choose **Mutinynet**, and connect to test BFA transfers. BFA is
available on test networks. The native bridge keeps `allowRecklessSchemas`
disabled. Mainnet uses the NIA, CFA, and UDA schemas.

The upgraded library requires RGB proxy protocol 1.0. Rate creates invoices on
Kaleidoscope Proxy v1 by default. A saved legacy KaleidoSwap address is upgraded
to that endpoint, and a saved Iris 0.2 address is upgraded to Iris 1.0. Custom
proxy servers must support 1.0. Create a new v1 invoice when using the updated app.

Rate opens existing RGB files in their previous locations and retains the
existing backup namespace. The native proxy migration marks older outgoing
transfers in `initiated` or `waitingCounterparty` as failed. Preserve an
encrypted backup before opening a legacy wallet with the new library.
[Upstream migration](https://github.com/UTEXO-Protocol/rgb-lib-bfa/blob/cafe66e49d58038a69dd05f8065e3fe96a9d1601/migration/src/m20261020_142324_proxy_v1.rs)

The [simulator probes](../../scripts/bfa-e2e/README.md) cover cross-version file
restore, address persistence, and decoding an encrypted v1 invoice generated
by WASM beta.4. The fixtures are unfunded Regtest wallets. Live BFA transfers
with an extension build and test asset on Mutinynet remain a separate check.

## RGB backup compatibility

When restoring an encrypted file, Rate verifies its wallet and Bitcoin network
before moving it into place. Backups from beta.7 and BFA have a wallet
manifest. To restore an earlier file without this metadata, export a newer
backup from the original wallet.

The app reads the existing cloud backup until its first successful upload to
the versioned pointer. Older releases still read and write the legacy pointer.
If an older device changes the legacy backup after this transition, Rate keeps
both versions and pauses cloud backup and restore. Export files from the two
wallets before choosing which copy to continue using. Update Rate on every
device before using the same RGB wallet across devices.
