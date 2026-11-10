# Rate maker / Arkade Mutinynet checks

This harness imports Rate's real `arkadeIntents.ts` service and the SDK versions
installed in Rate. It runs in Node with persistent SQLite repositories; it does
not prove React Native/Hermes or physical-device behavior.

Private test state lives in `~/.local/share/rate-qa/arkade-maker-20261103`, with
0700 directories and 0600 keys. Never copy that directory into reports. The
harness only accepts Alice/Bob and the pinned Mutinynet Arkade/maker endpoints.

Commands from the Rate repository:

- `node --experimental-eventsource scripts/arkade-e2e/probe.cjs status alice`
- `node --experimental-eventsource scripts/arkade-e2e/probe.cjs receive bob`
  creates one unfunded expiry fixture. Re-running returns its saved receipt.
- `node --experimental-eventsource scripts/arkade-e2e/probe.cjs board alice`
  settles existing boarding funds; never fund the boarding address twice.
- `node --experimental-eventsource scripts/arkade-e2e/probe.cjs send-live-lost-ack alice`
  spends at most 10,200 test sats through KaleidoSwap to the local Signet smoke
  node. It throws after the real funding broadcast to exercise lost-response
  recovery. The persistent attempt prevents a second send.
- `node --experimental-eventsource scripts/arkade-e2e/probe.cjs send-status alice`
  recovers that attempt in a fresh process, without another RFQ or send.
- `node --experimental-eventsource scripts/arkade-e2e/probe.cjs receive-funded bob`
  creates the separate receive fixture. `pay-receive.cjs` pays it once from the
  existing test Lightning node, capped at 10,200 test sats.
- `offline-funded bob` / `claim-funded bob` (probe modes) simulate failed HTTP
  calls, then recover the receive using a fresh process. The recipient process
  is also fully stopped while the Lightning payer submits its payment.
- `expiry.cjs` waits through the real quote deadline plus SDK grace window and
  verifies no premature cancellation while the BOLT11 invoice remains payable.
- `expiry-clock bob` (probe mode) exercises the real SDK's final cancellation
  with a controlled clock and a private in-memory copy of the unfunded record.
  It reads live chain evidence, never overwrites the persistent record, and
  must never send or negotiate an RFQ. This is not a real-time invoice-expiry test.
- `evidence.cjs` checks both Lightning payments succeeded and emits only public
  transaction/state fields to `output/maker-mobile-audit/arkade-live-evidence.json`.

The Lightning helper pins the existing local smoke node's TLS certificate and
reads its test API key without printing it. It expects that node on localhost
13646, configured on Mutinynet in the sibling maker test fixture. Do not run the
maker setup script: it can replace configuration and restart unrelated work.

The native RGB funding probe's `arkade-fund` mode sends exactly 30,000 Mutinynet
sats once, persisting an attempt marker before broadcast. A failed/uncertain
attempt must be inspected, never cleared just to retry.

Known live refusal: the faucet's refund invoice asks for CLTV 80, exceeding the
maker's 48-block limit. It was refused before any funding. Use the compatible
local Lightning node; do not weaken the maker's timing checks.

Funded refund fixture (Mutinynet only):
- `refund-prepare alice` creates a hold invoice with no known preimage and funds
  one swap, capped at 10,200 sats and a 26-hour absolute refund horizon. A private
  persistent marker prevents repeat funding. Never delete it to retry.
- `refund-fail-invoice alice` fails the held Lightning invoice.
- `refund-status alice` reopens the wallet/store and runs actual SDK recovery.
  The November 3 fixture funded 10,050 sats; its absolute refund time is November
  4, 2026, 16:40:06 UTC. A 90,624-second relative constraint also applies. A pending
  result before eligibility is expected; it does not prove refund success.

Native simulator harness:
- Start Metro with `CI=1 pnpm exec expo start --dev-client --port 8088 --max-workers 2`.
- `native.jsx` is an isolated development entry, never imported by the app entry.
  It uses Hermes, SecureStore, native SQLite, live Mutinynet and the live maker.
  It creates one UNFUNDED receive invoice, saves its record, simulates HTTP failure,
  and checks the same identity/receipt after process termination and restart.
  It never sends funds. Evidence is `rate-native-arkade-qa.json` in the app document
  directory; it contains public fields only. Native keys remain in SecureStore.
- iOS simulator builds must be locally signed (`CODE_SIGN_IDENTITY=-` and
  `CODE_SIGNING_ALLOWED=YES`) for Keychain access. Unsigned builds compile but
  SecureStore fails with a missing entitlement. Launch the installed dev client
  using its supported `--initialUrl` argument pointing at the harness bundle URL.
- Android: reverse port 8088 with adb, then open the `exp+rate` dev-client URL
  pointing at that bundle with `platform=android`. Warm the bundle first to avoid
  the launcher's initial network timeout during a cold compilation.
- `native-console.cjs [device-name-fragment]` reads the native Hermes inspector's
  diagnostic events. It does not automate or assert the UI.
- These checks do not replace full navigation/gesture, QR/camera, biometric or
  funded-swap testing inside the native application.
