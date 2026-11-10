# Live RGB checks on Mutinynet

This harness uses the **same generated Swift bindings, Swift mappers and pinned
rgb-lib iOS framework shipped by Rate**, running on an Apple Silicon iOS
simulator. Two new test-only wallets live in a dedicated state directory.

The app leg executes `RgbLibRnAccount.transfer`, `Wallet.send` and
`rgbL1TransferStatus` from the app source. A file/CLI transport replaces Expo's
in-process transport. Invoices, assets, Bitcoin transactions, acknowledgements
and confirmations come from the real native library and public Mutinynet.
It does not exercise the complete Expo UI, device lifecycle or a physical iPhone build.
The extended backup leg uses the real VSS service and native encrypted backups. UI and orchestration regression suites remain separate.

Requirements: Xcode with a booted arm64 iOS simulator, installed Rate dependencies
and its downloaded `rgb_libFFI.xcframework`. Set `SIMULATOR_UDID` to select a
particular booted device. Never point the state directory at an existing wallet.
Keep it outside the Git checkout; it contains test-only recovery phrases with
private file permissions. No credentials or existing user wallets are read.

From the Rate directory:

```sh
STATE=/absolute/path/to/new/test-state
bash scripts/rgb-e2e/run.sh "$STATE" prepare
```

Fund the displayed Alice address with **100,000 Mutinynet sats**. No mainnet
funding is needed. Then run the native baseline:

```sh
bash scripts/rgb-e2e/run.sh "$STATE" send
bash scripts/rgb-e2e/run.sh "$STATE" status
```

The first command issues 1,000 RATEQA units and sends 100 from Alice to Bob with
`donation=false`, a 1,000-sat witness output and one required confirmation.
Repeat `status` until `transfer-pass` appears (Alice 900, Bob 100). Each status
check refreshes **both wallets**. An exit code of zero alone is not a pass: a
pending transfer is a normal result and must eventually reach `settled` on both
ends. Send intent is saved before sending; reruns do not resubmit that payment.

Run the app-source leg, which sends another 25 units:

```sh
bash scripts/rgb-e2e/run.sh "$STATE" app-prepare
node scripts/rgb-e2e/app-send.cjs "$STATE"
node scripts/rgb-e2e/app-status.cjs "$STATE"
```

Repeat only `app-status.cjs` until both `app-transfer-pass` and the app resolver's
`rate-status-result` with `status: completed` appear. Final balances must be
Alice 875 and Bob 125. This also covers real chain-prefixed witness recipients
such as `sbc:wvout:...`. `app-send.cjs` refuses a second invocation once a send
was attempted, including an uncertain send result.

Finally test the app's actual network folder/settings functions and native
wallet reopening, followed by live connections to the configured indexers:

```sh
node scripts/rgb-e2e/network-config.cjs "$STATE"
bash scripts/rgb-e2e/run.sh "$STATE" switch
bash scripts/rgb-e2e/run.sh "$STATE" connect-networks
node scripts/rgb-e2e/app-status.cjs "$STATE"
```

The settings store is isolated from the app. `network-config.cjs` supplies the
real app's folder selections to the native probe. `switch-pass` verifies an
identical Mutinynet snapshot (BTC balances, RGB balances and full transfer
history) after opening Mainnet, Signet and Testnet in distinct folders.
`network-connected` must appear for all four networks. The final app status
check proves that the settled receipt remains recoverable after reopening.

Keep the state directory to retain the test funds and reproduce checks. Reports
must include transaction IDs and chain confirmation evidence, distinguish
pending from passed checks, and never include recovery phrases.


## Reverse transfer, recovery and failure checks

After the previous legs settled, create Alice's invoice. Bob needs a free
colorable output for change; the optional funding step sends 20,000 test sats
from Alice and is protected against duplicate submission.

```sh
bash scripts/rgb-e2e/run.sh "$STATE" extended-prepare
bash scripts/rgb-e2e/run.sh "$STATE" extended-fund
bash scripts/rgb-e2e/run.sh "$STATE" extended-utxos
node scripts/rgb-e2e/reverse-send.cjs "$STATE"
bash scripts/rgb-e2e/run.sh "$STATE" extended-offline
node scripts/rgb-e2e/reverse-status.cjs "$STATE"
```

Wait for BTC funding/output confirmations if necessary. `extended-offline`
refreshes only Bob, checks `waitingCounterparty`, then closes and reopens his
wallet across all networks with the same pending state. It must run before
`reverse-status`, which resumes Alice. Repeat only `reverse-status.cjs` until
`reverse-pass` and the actual Rate resolver report completion. Expected balances
are Alice 900, Bob 100. Earlier legs' hardcoded balance assertions no longer apply.

```sh
bash scripts/rgb-e2e/run.sh "$STATE" extended-invalid-invoices
node scripts/rgb-e2e/invalid-invoices.cjs "$STATE"
bash scripts/rgb-e2e/run.sh "$STATE" failure-tests
node scripts/rgb-e2e/backup.cjs "$STATE"
```

Invalid invoices are decoded by native rgb-lib, then rejected by Rate before
send. Failure checks use an empty test wallet and unreachable loopback indexer/
proxy endpoints, asserting unchanged asset balance and no new send on proxy
failure. They create unused receive invoices. Backups export Bob's real encrypted
file, reject a wrong password, restore into separate clean directories, upload
and download through the actual VSS client, restore again, and verify that Signet
has no Mutinynet backup. The VSS namespace belongs only to Bob's test seed. The
backup script can also run while a transfer is pending to verify its restoration.
Restored wallets are inspected/synced but never used to create new sends.
