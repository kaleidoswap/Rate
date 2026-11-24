# Beta: known issues

What testers of the beta builds should know before they start. Keep amounts
small: new wallets use Bitcoin mainnet.

## What is in the beta

- Bitcoin and Lightning on Spark, send, receive, scan, activity, Lightning address.
- Swaps on Flashnet (BTC ↔ USDB) and the cross-chain bridge.
- **Settings → Accounts & networks** has switches for Arkade and Bark in
  builds that support them.
- Prismo and contacts are on by default in **Settings → Labs**. Places to pay,
  wallet connections (NWC), the RGB Lightning node and Lightning channels
  start off.

## Not in the beta

- **KaleidoSwap maker swaps.** Swap shows Flashnet only.
- **New RGB accounts on this phone and merchant offers.**

## Known issues

- **Restoring a seed does not bring back RGB assets held on the phone.**
  RGB on this phone is not in the beta. If you hold RGB assets on a wallet
  from an earlier version, don't remove that wallet from the device.
- **Accounts from earlier versions stay.** If you set up Arkade, Bark or RGB
  before the beta, the account is still listed in Settings and keeps
  working, so you can access those funds in Settings.
- **Crash reports are opt-in and partial.** Turn on *Send crash reports* in
  Settings → Preferences to help. Crashes in native code (for example RGB,
  Bark or the on-device assistant) are not reported yet; please describe them
  in your feedback.
- **Prismo (Labs) needs a physical device** and downloads its models on
  first use (several hundred MB). It is experimental: always check an action
  before confirming it.
- **The app is large** (around 200 MB on Android) because of the on-device
  assistant's native libraries, even when Prismo is off.

## Reporting a problem

Say what you did, what you expected and what happened, plus the app version
and build number from Settings → About. Never share your recovery phrase,
keys or screenshots that show them.
