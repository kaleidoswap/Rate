# Changelog

All notable changes to the KaleidoSwap wallet are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> ⚠️ **Alpha.** KaleidoSwap is under active development and not production-ready.
> The KaleidoMind AI assistant is experimental and can make mistakes — review
> actions before confirming. Use test networks and small amounts only.

## [Unreleased]

## [0.15.0] — 2026-11-12

The you-already-know release: Send shows what you have before you commit,
Receive is the QR, the assistant has one name and the phone speaks Italian.

### Added
- **Send shows what you have and what it costs, immediately.**
  - A request that arrives complete (scanned, pasted, a contact, a
    Lightning invoice with an amount) goes straight to the routes and fees:
    no Continue tap. The quote loads while you read the target.
  - Your account balances appear under the amount display in the input
    phase — "Spark 5,000 sats · Arkade 9,000 sats" — so you know what you
    can pay with before committing.
  - The amount editor gains a Max chip for bitcoin sends (fills the total
    spendable across all accounts), matching the Max that already exists
    for tokens and RGB assets.
- **Receive is the QR.** Under the code: status, amount, and Share as the
  primary action — the "Other formats" card, the exclusion notes and the
  contact picker are gone from the main flow. The options pill opens the
  routing sheet directly (one sheet, not a sheet inside a sheet); choosing
  a method closes it. Receiving via Lightning went from five taps across
  two stacked sheets to two.
- **The assistant's tab is Prismo.** The bottom-bar tab "Mind" becomes
  "Prismo", completing the one-name work across Settings, chat, voice and
  onboarding.
- **Onboarding speaks Italian.** The wallet setup, security and profile
  screens follow the app language: titles, buttons and descriptions render
  through the same localization dictionary the assistant uses.
- **Deposit notifications wake up.** The payment-notification toggle now
  registers the expo background task (a balance check every ~15 minutes
  that raises a local "Payment received" notification while the app is
  backgrounded) and the app defines the task at start. Previously the
  infrastructure existed but was never wired.

### Changed
- **RGB receive is one tap away.** The asset tab row on the Receive screen
  gains an "RGB" tab when the RGB wallet is connected — it opens the asset
  picker (Any RGB asset first, then held assets and contract ID), not a
  dead-end.

### Fixed
- Swap success: the txid is selectable and copyable, and a "View in Activity"
  button takes you to the entry (it was a dead string with no actions).
- The contact picker says the right thing: "Choose a friend to request
  payment from" when opened from Receive, not "to send payment to".
- The AI chat's last bubble says what was done ("Your invoice is ready.",
  "I've checked your balances.") instead of just "Done." — and a stopped
  turn says "Stopped — nothing was completed.", not "Stopped."
- The onboarding step indicator names the current step ("Start", "Backup",
  "Verify") instead of showing anonymous dots.
- A PIN mismatch says "PINs don't match — try again." inline under the dots,
  not in a native alert.
- The drain fee tabs show sats ("Slow · 250 sats"), not the raw sat/vB rate.

## [0.14.0] — 2026-11-12

The RGB-and-honesty release: RGB speaks people, the launch never strands
a wallet, one name for the assistant, fiat everywhere money appears.

### Removed
- **The deprecated service facades are gone.** `WalletManager` (a thin
  leftover over ProtocolManager) and the last `RGBApiService` references:
  switching wallets talks to `protocolManager` and `initializeProtocols`
  directly, and the never-dispatched `initializeWallet` thunk (with its hook
  wrapper) is deleted. AGENTS.md no longer points anyone at the facades.
- **Dead code swept** (~800 net lines across four PRs): the never-mounted
  IntentSheet/IntentCards/useIntentRunner trio, WalletSetup's unreachable
  "Wallet Created!" step, the duplicate "Swap Status" card under the swap
  form, the unwired `paymentConfirmed` hook in the AI chat, and
  SecuritySetup's entire unreachable "Secure Your Wallet" card step with
  its handlers, "Complete" step and 13 orphaned styles.

### Fixed
- **The launch never strands an existing wallet on "Create wallet."** A
  database error at startup now tries to read the wallet list before
  deciding where to go: users with wallets land on the dashboard (the
  banner there says what failed), only a truly empty phone sees setup.
- The "Connect to Nostr" button in the contact picker (Send, Receive, chat)
  actually navigates to Nostr settings — it was a dead button.
- Cross-chain Activity records respect the chosen bitcoin unit (BTC vs
  sats) like the rest of the app.

### Added
- **The identity is payable.** The dashboard's profile chip shows your
  lightning address under your name — your kaleidoswap.me handle when set,
  else your Nostr address — one glance from "who am I" to "how people pay me".
- **The Activity tab counts what needs you.** Payments pending or needing a
  check wear a badge on the tab bar, so waiting payments are not discoverable
  only by opening the list.
- **UI previews without running the app** (`npm run ui-preview`): jest
  renders the wallet's real components into a dark HTML gallery.

### Changed
- **RGB speaks people.** "UTXO" is now "receive slot" everywhere the user
  sees it — 21 strings in the receive flow, the slot sheet, the wallet tools
  and every error message. "Witness" and "Blinded" invoice types are
  "Standard" and "Private", with the sender's privacy the explanation, not
  the protocol. Fee-speed tabs in the slot sheet show sats (like everywhere
  else), and the RGB review in Send explains what slower costs. `sat/vB`
  stays only in the technical sheet where the fee rate itself is the choice.
- **Connecting RGB on this phone is one decision, not three.** The ~55-word
  informational alert is gone: the screen above the Connect button already
  says what RGB on this phone is (real funds, cloud backup, separate
  wallets per network). Connect goes straight to the backup check. When a
  cloud backup exists, one confirmation shows what Restore and Start empty
  each mean — the double "Start without the backup?" follow-up is gone.
  A missing backup on "Restore from cloud" answers on the screen, not in
  an alert.
- The RGB account page always says which side is active (the phone or the
  node), and what happens when you connect the other.
- `ERR_RGB_*` codes no longer appear in user-facing copy: connection errors
  in Settings describe the problem in plain words and point at diagnostics;
  uncertain RGB payments say what to do without the code; and the
  receive-error fallback translates adapter errors instead of passing them
  through raw.
- **One name for the assistant.** Prismo everywhere: the onboarding modal,
  chat empty state, voice overlay, error banners, agent-wallet messages and
  Settings — no more mixing "Agent", "KaleidoMind" and "Prismo".
  The one-row "Mind" settings page is gone; Prismo's settings live under
  Connections.
- **Fiat in the Swap.** "You Receive" carries its ≈ dollar value under the
  amount, like every other surface that shows money. Swap also tells you
  when it caps your amount ("Capped to your maximum of N"), instead of
  silently rewriting the number you typed.
- **One microphone per job in the chat.** The dictation mic stays in the
  input bar; "Talk to Prismo" becomes a labelled pill beside it, not a
  second unlabeled mic button.
- The Bridge's two contradictory sentences — "Keep the app open" vs "You
  can leave" — now say what they mean: "Keep the app open while we pay
  from Spark (a few seconds)" and "Payment sent. After this you can
  leave; we keep following the order." The fee note says "during the
  swap", not "on the routing leg".
- **Networks are picked on the same sheet as everything else.** Changing
  an account's network opens the standard option sheet (with the current
  selection marked) instead of a native alert with buttons.
- **Display detail leads Preferences.** The Simple/Advanced choice is the
  first thing on the page, with plainer descriptions: "Balances and payments,
  without networks and technical options" vs "Networks, routes, channels and
  wallet tools". The row's value now says "Simple" instead of "Lite".
- Settings search answers more words: "sats" finds the balance unit,
  "seed" the recovery phrase, "mainnet" the accounts, "simple view" the
  display detail.
- Swap says "Enter amount" like every other button; the "Explore maker
  routes" tile is hidden in Simple view (it was noise for Lite users).

## [0.13.0] — 2026-11-11

## [0.13.0] — 2026-11-11

The payments-and-cards release: one gesture for every amount, people-first
sending, one story per payment, and a dashboard that settles.

### Added
- **The wallet's own number pad.** Amounts are entered on big keys with a tick
  of haptics each press — no OS keyboard in the middle of a payment. The
  decimal point only appears where one belongs (never in sats), the display
  groups thousands as you type, and every composed value is a plain decimal
  by construction.
- **One amount editor everywhere.** Sending bitcoin, a Spark token or an RGB
  asset opens the same amount sheet (big display, quick Max chip for tokens,
  validation against the available balance) instead of three different
  inline inputs.
- **People-first Send.** Typing a name autocompletes your contacts; picking
  one jumps straight to the amount — keypad, then the usual review. No
  Continue tap in between.
- **A shared success overlay.** A payment sent from this screen (or settled
  while it is open) celebrates full screen — check, amount, recipient, what
  you paid from — with "See receipt" behind it and "View in Activity" on the
  receive side. One moment, one look, both directions.
- **Search in Activity.** The header gains a search toggle: typing filters by
  contact, amount, asset or transaction id, live across the whole list (the
  search machinery existed; it had never been wired up).
- **A dashboard that settles.** Loading states are skeletons in the shape of
  the content they become — the balance card and the activity rows no longer
  jump when the data lands — and a wallet with no activity keeps its "Recent
  activity" section, pointing at receiving instead of leaving a hole.
- Bitcoin amounts in Activity rows, the dashboard's recent-activity card and
  the detail sheet now carry their ≈ fiat value too.
- **UI previews without running the app** (`npm run ui-preview`): jest renders
  the wallet's real components into a dark HTML gallery.

### Changed
- **One payment, one story.** Type names ("Received", "Payment", "Swap"),
  signs, colors, statuses and timestamps are decided once in
  `utils/activity-presentation` and used by the Activity rows, the dashboard
  widget and the detail sheet. A swap no longer looks like a green inflow on
  the dashboard and a neutral row in Activity; "Atomic Swap", "Sent vs
  Payment" and "Confirmed on-chain vs Completed" divergences are gone
  (on-chain confirmation is said in words under the status). Rows everywhere
  tell one compact age ("2h"), the sheet keeps the full date, and the
  recent-activity card shows the type next to a contact ("Payment · Alice").
- **No more refresh stairs.** An expired price refreshes itself and the
  slide-to-pay stays armed; after a manual refresh the new total is noted
  briefly ("Price updated · now N") instead of demanding a second review.
  "quote" is now "price" in the payment flow.
- **How they pay, in one place.** Receive options no longer nest a sheet in a
  sheet: one "How they pay" row opens a single sheet with the methods, the
  network and the account side by side.
- The receive QR keeps its calm: the "Other formats" card folds its exclusion
  notes away with the formats themselves, and the asset tabs stay above the QR
  (out of the options sheet).
- **One control per job on the balance card.** Refresh keeps its corner; the
  network breakdown opens from a written "Details" toggle under the balance —
  no more twin icon buttons to tell apart. Calmer words follow: "Some funds
  are still confirming." replaces the engineer-speak, the allocation caption
  counts accounts, and test funds drop their lecture.
- Friendlier scanner: a bad QR code auto-resumes scanning after a moment
  instead of waiting for "Scan again", and the error and instruction copy is
  plain language. Its chrome (spacing, type, corners) now follows the design
  tokens; the camera keeps its dark backdrop in every theme.
- The AI chat's invoice and address cards show the same QR as the rest of the
  wallet (tap to enlarge and brighten included) instead of a private copy of
  the renderer.
- Maker routes say "Accepts N–M sats"; the fee-speed choice no longer shows
  "sat/vB"; the destinations hint lists "Lightning invoice or address"; and
  receiving from an asset's page now actually opens that asset's receive
  request (the parameter it passed was being ignored).
- One calm safety line everywhere a payment is being checked: "Don't pay this
  twice." replaces the six repetitions of "Do not send again."
- Cleanup: 11 legacy header styles and a dead `onIssueAsset` prop removed
  from the dashboard; hash and id text uses the design-system mono font
  (was Courier New); sub-12px label sizes raised to the token scale; the
  balance figure uses the type scale's own 4xl/black tokens.

### Fixed
- RGB receive retry message no longer talks about "blocking the screen in the
  background" — it just says the request is ready.

### Validation
- CI (type-check, tests, iOS and Android production bundles) passed on every
  pull request of this release. Device testing of the 0.11.0 items (RGB
  runtime-lock clearing, mempool deposit detection, voice audio route)
  is still pending.

## [0.12.0] — 2026-11-10

### Added
- **Maker routes.** Swap shows the maker's published routes — which assets it
  sends and receives, in which amounts — on a dedicated Maker routes screen,
  with the chosen route summarized in the payment review (MakerRouteList,
  SwapRouteSummary).

### Changed
- `@kaleidorg/wallet-engine` moves to 1.0.0-beta.80 (the beta.75 patch is
  upstream now); `@kaleidorg/swap-sdk` to 0.14.1 with `@arkade-os/sdk` 0.4.78
  and `@arkade-os/swap` 0.0.24; `bip39` to 3.1.2, with `bitcoinjs-lib` 6.1.10
  pinned by override.
- Every sats and token amount now formats with `en-US` grouping regardless of
  the host locale, so unit tests and CI are deterministic on any machine
  (dates stay locale-aware).

### Security
- Build-time dependencies moved past three Dependabot advisories: `glob`
  13→14.0.2 (post-timeout filesystem traversal), `minimatch` 9/10→11.0.1
  (globparts denial of service), and `deepmerge` 4.3.1 patched locally
  (`mergeObject()` prototype poisoning of returned objects; no upstream fix
  published yet). None of these ship in the app binary — Expo CLI and Jest
  build tooling only.

### Removed
- Dead code and dependencies: `axios` (no usage since the service-layer
  refactor), the unused web target (`react-native-web`, `react-dom`,
  `@expo/metro-runtime`, the `web` script and Metro's `web` platform — no CI
  build or documented flow used it, and the wallet needs native modules), the
  `upng-js` color-averaging helper nothing imported, plus orphaned components
  and hooks (`NetworkBadge`, `mind/IntentBar`, `mind/AgentWalletCard`,
  `useBackupHealth`, `useIsNarrow`, `speechLanguage`, `payment-receipt`,
  `request-guard`, `iconAverageColor`) with their tests.
- Unused dev tooling: `@babel/preset-env`, `jest-expo`, `bare-pack` (each
  already provided where needed).

### Validation
- CI (type-check, tests, iOS and Android production bundles) passed on both
  pull requests. Device testing of the 0.11.0 items (RGB runtime-lock
  clearing, mempool deposit detection, voice audio route) is still pending.

## [0.11.0] — 2026-10-20

### Changed
- Streamlined payment review, receipts and Activity; recent activity appears below the wallet balance.
- Show the selected payment account with alternatives under Change account.
- Expose receive asset selection, distinguish open RGB requests from incoming transfers, and move technical settings under Advanced.
- Remove the manual Check status action from Activity details.

### Fixed
- Make failed RGB transfers removable immediately after successful cancellation.
- Reject failed HTTP downloads and incomplete AI model files before native loading; expose model-load diagnostics and model settings.
- Include pending RGB routing, amount, backup, timeout, NWC and native iOS fixes from the working tree.
- Align native release versions and archive validation with the release tag.

### Validation
- TypeScript and production JavaScript bundles for iOS and Android passed.
- Payment and RGB receive regression tests passed; native behavior still requires device validation.

## [0.9.12] — 2026-10-17

### Fixed
- **RGB on this phone not connecting.** rgb-lib leaves a runtime lock behind when the app is killed mid-call, and every later open waited up to an hour for it, blocking mainnet and Mutinynet alike. A leftover lock is now removed when no open wallet uses that folder, an open gives up after 3 minutes with `ERR_RGB_OPEN_TIMEOUT`, and a wallet that fails to go online is closed. The native part takes effect with this build.
- **RGB connection errors are visible.** RGB settings show the last failed connection with its `ERR_RGB_*` code, and a Diagnostics row shares the connection log, also while disconnected.
- **On-device AI failing to load.** Model downloads are checked (HTTP status, size, free space) before use, a corrupt model file is deleted so Retry downloads it again, and the Agent banner shows the underlying reason instead of only "failed to load". Chat model and speech recognition errors no longer overwrite each other.
- **Removing a payment that needs checking.** A payment still pending or marked "Needs checking" can be removed from Activity: "Remove from Activity" on its receipt, or a long press on its row. It also leaves the contact's history. A confirmation explains that only the record on this phone is removed: nothing is cancelled and no funds move.
- **Disconnected RGB node still in the balance details.** Once startup is done, an account that is off or disconnected leaves the breakdown, and the Lightning row shows only while a node is connected.

### Changed
- Balance card: only the figure and its equivalent; no label above and no status text below. The refresh button is the updating indicator, and pending funds, test funds and sync notes are in the expanded details. Refresh and expand buttons are smaller.
- Asset list: the full-width "View N more" row is gone; the View All link stays.
- Activity: the search field is replaced by a filter button that opens a sheet (type, period, network); active filters show as removable chips. Contacts get a new search bar.
- Profile: redesigned, with the Nostr QR card and Lightning address; the Settings button is removed, Nostr settings stays.
- Prismo settings: status card on top, grouped sections, and a danger zone with "Delete unused models" and "Clear memory".
- Empty states and callouts are drawn with kaleido-ui components.

### Validation
- CI (type-check, tests, iOS and Android production bundles) passed on the pull request. The native RGB changes and the AI load recovery still need testing on a device with this release.

## [0.9.11] — 2026-10-14

### Fixed
- **RGB receive.** Bitcoin sent to the RGB wallet on this phone is detected while still in the mempool; a deposit already waiting, or the wallet's own change, no longer reads as a new payment. RGB transfers show which asset and how much arrived, including invoices for any asset, and a newly received asset is never shown by its raw id.
- **Stuck RGB node payments.** A Lightning payment over NWC whose answer never came is followed by the invoice's payment hash instead of staying on "Needs checking"; an explicit refusal from the node is recorded as not sent. Payments recorded by earlier versions without a hash still need to be dismissed by hand.
- **Assets disappearing on open.** The dashboard keeps each account's last known assets until that account answers, instead of dropping RGB assets during the early load and showing them again seconds later.
- **Voice replies through the earpiece (iPhone).** Hands-free voice opens its audio session with the loudspeaker as default, playback is routed to the speaker right before speaking, and a cancelled recording start no longer leaves record mode on.

### Changed
- Activity details are condensed into one card, with the asset id (copyable), method and network on one line, and the fee only when known.
- One updating indicator on the balance card instead of four; "View All" is a small text link.
- Voice mode: Prismo shows its thinking pose while thinking, and the speech bubble is easier to read.
- Prismo explains Bitcoin, Lightning and RGB concepts from an on-device knowledge base, in English and Italian.

### Validation
- CI (type-check, tests, iOS and Android production bundles) passed on both pull requests. Device testing of the voice audio route and the RGB mempool detection remains to be done with this release.

## [0.9.3] — 2026-10-12

### Fixed
- Receive now monitors Bark's separate on-chain wallet, native Spark requests with an amount, and USD token balances on Spark. Arkade Lightning claims are checked immediately on reopening Receive. Balance watchers follow outgoing funds so a later incoming payment is not hidden by an older baseline.
- Pending and unknown sends with a provider reference continue to be checked without resubmitting. Bark preserves a confirmed Lightning result across restarts and later lookup failures.

### Changed
- On-chain payment results and shared receipts distinguish **Sent to the network** from **Confirmed on-chain**. Block inclusion is checked using the transaction ID and recorded network; unavailable checks never imply confirmation. Activity details explicitly label pending and confirmed on-chain transactions.
- On-chain sends awaiting block confirmation resume checking when Send is reopened. Older receipts without enough information remain unconfirmed rather than guessing their outcome.

### Validation
- 1,779 tests passed across 238 suites; TypeScript passed. End-to-end payments on physical devices remain to be verified with this release.

## [0.9.2] — 2026-10-12

### Added
- **Supertonic 3 through QVAC.** On-device multilingual speech, including Italian, using the Q8 model downloaded on first use. Preserves accented text, detects language automatically, and drives Prismo's mouth from audio playback. System speech remains a fallback if neural speech is unavailable.
- **Quick profile setup.** Create a Nostr profile during onboarding with an identity derived from the wallet recovery phrase, and optionally claim a username at kaleidoswap.me.

### Changed
- Simplified Face ID setup, compact account settings under Connections, and clearer backup, balance, payment receipts, Activity filters and Receive flows.
- Larger animated Prismo, a prominent microphone and spoken reply bubble in Talk, with continuous conversation enabled by default.

### Fixed
- Automatic payment status reconciliation, including Arkade provider queries, and protection against stale payment results overwriting newer states.
- Incoming-payment detection after returning to the app, recovery-word validation and persistent retry tracking for RGB backups.
- Neural voice selection now supports Italian without forcing system speech, and starting speech no longer unloads the active transcription model.

### Validation
- 1,761 tests passed across 236 suites. Supertonic 3 Italian synthesis was verified with the native QVAC runtime on macOS; physical-device voice performance and microphone routing remain to be checked with this release.

## [0.9.1] — 2026-10-10

### Changed
- **Agent experience.** One chat composer, separate dictation and Talk actions, accessible model settings and chat clearing, compact messages and payment summaries. Removed the extra Prismo input from the Dashboard.
- **Original Prismo, animated.** The approved crystal artwork greets users on the welcome screen, blinks and breathes, and follows native speech playback in Talk. A continuous 2D mesh avoids detached hand and mouth cutouts. Rendering now follows the visible size, uses fewer triangles, respects reduced motion and pauses in the background.
- **Profile and wallet.** More compact profile details and editing, optional profile suggestions, claimzero.me links, clearer Bitcoin allocation, relay status/reconnection improvements and cross-chain receive under additional options.

### Fixed
- Talk uses the saved voice language, with a language choice in Models & voice and a system-voice fallback for non-English speech.
- Pause, close and backgrounding cancel pending voice startup. Late sessions are disposed of before recording; cancelled recordings cannot submit late transcriptions.
- Talk distinguishes model download/loading, microphone startup, listening and speaking, and only reports readiness when both models are ready.

### Validation
- 1,722 unit tests passed; TypeScript and production iOS/Android JavaScript exports passed. CI now checks both mobile bundles for the three unpatched tooling dependencies flagged by Dependabot; these were absent from the inspected bundles. The tooling alerts remain open.
- Native QVAC conversations, microphone routing and sustained performance on physical devices remain to be tested with this build; simulator speech is not a substitute for those checks.

## [0.9.0] — 2026-10-10

### Added
- **RGB on this phone.** A complete on-chain RGB wallet that runs on the phone, on the official rgb-lib 0.3.0-beta.7: receive, send, issue and see RGB assets without a node, on mainnet or Mutinynet. Receive is clearer about which way to get paid.
- **Prismo.** KaleidoMind has a face: an animated character in the Mind tab, in chat, on the voice screen and on the cards the assistant shows. It looks, listens, thinks, speaks and reacts to what happens (a payment sent, something that needs a look).
- **Agent wallet.** A separate wallet with its own budget that KaleidoMind can pay small services from (paid data APIs over L402 / MPP) without touching your main funds. Set a limit per payment, per day and per month, pause it, and see every payment in its log. Anything above the limits asks you first, and the sheet shows what the limits leave.
- **Tell KaleidoMind what to do.** A bar on the Dashboard and the Mind tab takes a typed or dictated request ("send 10€ to Mario", "swap half my BTC to USDT", "receive 50k sats on Lightning", in English or Italian) and answers with a card: amount and fiat value, recipient, route and estimated fee, from the wallet's own prices and quotes. Review opens Send, Receive or Swap filled in, where you confirm as usual. Common requests work without the model; questions like "how much did I spend this week" get a small summary from Activity.
- **Explain.** Activity details (the payment, its fee, an RGB transfer's step), a failed swap and Send errors have an Explain button that says what happened in a few plain sentences, on this phone, with a built-in explanation when KaleidoMind is off.
- **Insights on the Dashboard.** Small cards for things worth a look: an RGB backup that failed or never ran, little room to receive on an RGB channel, a swap or payment still unconfirmed, a large payment received, low network fees. Each has one action and can be dismissed.
- **Lightning address (kaleidoswap.me).** Claim a permanent `name@kaleidoswap.me` from Settings → Lightning address, as in the extension: live availability check, then a signed claim with the Spark identity key. Anyone can pay it from any Lightning wallet and it lands in Spark, even when the app is closed. Share it (copy, share, QR), release it, and find it again automatically after restoring the wallet. Receive shows it under the code.
- **Payment notifications.** "Payment received" notifications, on by default (Settings → Preferences):
  - with the app closed, kaleidoswap.me pushes to the phone when a payment to your Lightning address lands (the amount and address pass through Apple or Google);
  - while the app runs in the background, a balance that went up raises a notification;
  - a periodic background check (when the OS allows, often every 15 minutes or more) does the same for other payments, connecting only Spark.
- **RGB node backup, said plainly.** Settings → RGB → RGB Lightning Node has a Backup section: the recovery phrase doesn't restore anything on a connected node (its bitcoin, RGB assets or channels), only the node's own backups do, so back it up where it runs or ask whoever runs it. RGB on this phone tries to back up to the cloud after every change.

### Changed
- **Send redesigned.** One field with Paste/Scan (and Clear) inside it, a card saying what was detected (kind, amount, note, expiry), and recent contacts. Open amounts are entered on a large amount you tap. Review shows **Pay from** account cards with each account's balance and what this payment costs from it (best price picked and marked; an account that can't pay says why), a route line (account → rail → recipient, with the swap provider when there is one), and **slide to pay**. "Ways to pay" is now the shared bottom sheet, grouped by account. The result screen has an animated check, View in Activity and Share receipt. Quotes, the payment journal and double-send protection are unchanged.
- **Bark is an Advanced account.** In Lite it is not offered on Receive, and Send lists it only when it holds funds. It is still managed from Settings → Advanced.
- Icons match the extension: the white Spark asterisk, the extension's RGB logo (transparent, no white square), and on-chain shown as the chain-link glyph instead of the Bitcoin coin wherever it is a way to pay.
- Receive: the amount is a pill centred under the QR ("Add amount", or the amount you asked for).
- Receive has two ways to set up a request: **By method** (how it arrives, then which account it lands in) and **By account** (pick Spark, Arkade, Bark or the RGB Lightning node by its balance, then Spark/Ark, Lightning or On-chain). The switch slides, remembers your choice, and only shows for BTC when more than one account can receive.
- New wallets connect Spark and Arkade on mainnet by default (Bark already did). Wallets saved before this keep the network they were on; the RGB node stays on test networks until it supports mainnet.
- One animated bottom sheet for every picker and form sheet: the backdrop fades instead of sliding, the sheet springs up, can be dragged down to close, and respects Reduce Motion. Swap review, asset pickers, Receive choices, settings options, zaps, amounts, contacts, channel details and the chat payment card all use it.
- Swap asset picker redesigned: BTC/USDT quick picks, search, assets you hold first (largest balance first), the network each asset moves on, balances in your unit, and picking the other side's asset flips the pair.
- Swap review leads with what you pay and what you receive; the flip button turns and the quote details ease in; a finished swap shows an animated check.
- Screens push with the same slide on iOS and Android and can be swiped back; root screens (setup, home) fade.
- Home shows recent activity with a link to the full Activity tab, and "Places to pay" only once the wallet is set up.
- When some accounts can't refresh, Home names them in a banner instead of an alert; a full refresh failure is a banner too.
- **Lite mode** now also applies to Swap (no venue tabs, maker address or
  account names: the best price is picked) and Activity (no network chips).
- **One name each.** The RGB/RLN node is the "RGB Lightning node" (a plain NWC
  wallet is a "Lightning wallet"), the assistant is "KaleidoMind", and account
  networks show as Mainnet / Signet / Mutinynet / Regtest instead of raw values.
- **Swap MAX** uses the balance of the account the swap spends from (Spark for
  Flashnet, the RGB Lightning node for KaleidoSwap), not the wallet total.
- **Channels** expand in place on the home screen, with one "Open a channel"
  action; "Connect Nostr" prompts open Nostr settings directly.
- **Receive.** Pick how you get paid (Any wallet, Lightning, On-chain, Spark, Ark)
  and, where more than one account can take it, which account it lands in: a
  Lightning payment can go to your RGB node, Spark, Bark or Arkade. The code is
  shown with a readable breakdown: the universal code lists each way to pay it,
  each with its own copy and QR, and a single address or invoice is shown in full.
- **Lightning into Arkade** works again, through Arkade Intents swap providers
  (KaleidoSwap first) instead of Boltz. It needs an amount; the sender pays the
  swap fee, and the wallet claims the payment while Receive is open.

### Fixed
- **The confirm sheet and the payment can no longer disagree.** A payment from chat or voice goes to exactly the destination the sheet showed, even if the contact's address changed in between. An invoice's own amount is the one shown and paid; a different amount from the assistant is refused. An invoice that a Lightning address returns for another amount than you approved is refused.
- **Flashnet swaps show their floor.** The review says the least you can receive ("At least"), and the swap is bound to it: 1% below the quote instead of a hidden 5%.
- **Assistant errors are readable.** The chat says what to do next (clear a long chat, reload the model, check the connection) and no longer prints raw technical errors.
- Activity shows what is known at once and adds each account as it answers, instead of waiting for the slowest one.
- RGB on this phone is no longer reported offline right after it connects.
- KaleidoMind no longer crashes the app when the on-device model can't start.
- Payment sounds play again: Send chimes when a payment completes (or fails), and Receive plays the received chime when a payment arrives.
- Swap explains when trading pairs are loading, empty or failed to load, with Retry or a link to Settings.
- The Nostr private key and NWC connection string are copied with the auto-clearing secure clipboard.
- Cards no longer fall back to white / light-grey / purple colors, and their
  content is no longer remounted on every render (an input inside a card kept
  losing focus). Receive and the channel screens use the shared header; Send's
  amounts use tabular figures.
- **Restore from the first screen.** A fresh install (or a removed wallet) can
  now restore from a recovery phrase ("I already have a wallet"). Restore no
  longer shows an unfinished network step: it brings back the same accounts a
  new wallet gets, accepts 12- or 24-word phrases, and offers PIN / biometrics
  like setup does.
- **Balance total counts real bitcoin only.** Accounts on a test network
  (regtest, signet, mutinynet) are shown as "Test funds · no real value" and no
  longer inflate the total or its fiat value; Bark on mainnet now counts.
  Incoming pending funds show under the total instead of a collapsed section.
- **Confirmations.** Removing a Lightning wallet connection asks first, and
  removing the wallet asks for the device passcode or biometrics.
- AI model sizes under 1 GB no longer show as "0 MB".
- **Universal QR.** It mixed accounts on different networks (for example Spark
  on regtest with Arkade on mutinynet), so wallets read it as a request for the
  wrong network. Each code is now for one network, with a picker when your
  accounts span several. Accounts are asked in parallel instead of one after
  another, Bark is included, and a manual refresh is no longer replaced by an
  automatic one.

### Removed
- The `get_swap_quote` assistant tool, which only pointed at the Swap screen; the assistant quotes with the KaleidoSwap tools and swaps after you confirm.
- Screens nothing opened (payment success, Nostr setup, duplicate History and
  assistant routes) and eight unused components.
- The pre-payment "confirmation" screen for channel orders: the order's
  invoice now opens straight in Send.
- Asset detail's "coming soon" buttons (more options, history, export, scan);
  pull down to refresh instead. The header bell that pointed nowhere.
- The unreachable wallet-list screens (Wallet list, Add wallet, Wallet
  settings), including a placeholder that generated a fixed, public seed.
- **Liquid.** The Liquid wallet layer is gone: wallet setup, Receive (including
  Liquid USDt in the USD request) and Send no longer offer it, and pasting a
  Liquid address says it isn't supported. Its native library (`lwk-rn`) was the
  largest single part of the Android APK. Wallets that had Liquid enabled keep
  working; the Liquid setting is ignored.

## [0.3.0] — 2026-10-03

KaleidoPay and universal BOLT12 payments, Second's Bark as a regular wallet
layer, a reusable merchant QR, and a round of security and payment hardening.

### Added
- **KaleidoPay**: pay BOLT12 offers, universal payment QRs and plain bitcoin
  addresses by comparing direct payment with Electrum swap providers over
  Nostr. Shown inside Send, so paying has one screen. Interrupted swaps are
  resumed on start.
- **Bark (Second's Ark)** as a regular layer, on mainnet by default
  (`EXPO_PUBLIC_BARK_NETWORK=signet` for test sats): balance, Ark address and
  Lightning receive, boarding from on-chain, and payments over Lightning,
  BOLT12, Ark and on-chain.
- **Reusable merchant QR**: a persistent BOLT12 offer that lists the user's
  connected accounts as receiving layers, created over NWC, with receipts.
- Per-account settings, Arkade server configuration and searchable settings.

### Changed
- Receive, Scan, Pay and the payment review were reworked; the dashboard is
  more compact and Recent Activity lives in the Activity tab.
- KaleidoPay quotes are priced from providers' published offers; a swap is
  opened only when the user pays.

### Security
- The wrong-PIN lockout is stored and survives restarts; with a wallet PIN set,
  biometrics fall back to that PIN instead of the phone passcode.
- Salted PIN hashes, fail-closed secure storage, Nostr/NWC secrets kept out of
  AsyncStorage, in-app approval for Wallet Connect payments, screenshots blocked
  while a recovery phrase is shown, decrypted messages no longer persisted, and
  console logging stripped from release builds.

### Fixed
- Plain addresses and combined bitcoin + Lightning QRs are routed correctly;
  fixed-amount BOLT12 offers are paid exactly the amount reviewed.
- A failed KaleidoPay payment no longer blocks later payments.
- Bark Lightning invoices, detection of incoming Bark payments, Bark fee
  checks in Send, and the boarding panel.
- RGB Lightning invoices are always open-amount.

## [0.2.1] — 2026-08-31

Dependency refresh (patch/minor bumps within existing semver ranges, plus an
Expo SDK 54 compatibility alignment) and a fix for the pnpm-based native
toolchain, alongside a substantial test-suite repair.

### Fixed
- **pnpm native toolchain**: pnpm ≥10 stopped reading `node-linker` from
  `.npmrc` — it must be declared in `pnpm-workspace.yaml` instead. This was
  silently breaking the flat `node_modules` layout the QVAC/bare-kit native
  addon linker depends on, causing the `postinstall` bundling step
  (`sync-qvac-bundle.js`) to fail with a `bare-process` module-resolution
  error. Moved the setting; `.npmrc` now just points at the new location.
- **Jest test suite**: 11 of 23 suites (35 tests) were failing before this
  change. All now pass (23/23 suites, 276 tests):
  - `transformIgnorePatterns` only allowed the bare `expo`/`react-native`
    packages, not their hyphenated siblings (`expo-font`, `expo-camera`,
    `react-native-reanimated`, …) — these ship ESM and need the same Babel
    transform.
  - Added mocks for `@expo/vector-icons`, `expo-audio`, `expo-file-system`,
    `expo-haptics`, and `react-native-safe-area-context` (all need a native
    `globalThis.expo` binding that only exists on-device).
  - Hand-rolled a `react-native-reanimated` mock — its own shipped mock
    still pulls in the real `react-native-worklets` native module in v4.
  - The `react-native` test mock was missing `Switch`, `Modal`, and
    `Pressable`, and `StyleSheet.flatten`, breaking
    `@testing-library/react-native`'s host-component detection.
  - `TouchableOpacity` is now a small real component (not a bare string) so
    a `disabled`/`loading` press is correctly swallowed — `fireEvent.press`
    doesn't check `disabled` itself and walks up to any ancestor's `onPress`
    if the pressed node's own handler is missing.
  - Fixed several tests asserting against a stale API: `Toast.test.tsx` was
    written against a `ToastService` shape (`addListener`/`hideToast`/
    `showSuccess`, …) that no longer exists (`subscribe`/`dismiss`/`success`,
    …); `ErrorBoundary.test.tsx`'s custom-fallback tests assumed `fallback`
    is rendered as a component when it's actually called as a plain
    `(error, errorInfo, reset)` callback; two reset-flow tests pressed
    "Try Again" while the child prop was still configured to throw, which
    just re-triggers `componentDidCatch` before the child ever gets a chance
    to render — swapped the ordering.
  - `ErrorBoundary`'s error heading was missing an `accessibilityRole`.

### Changed
- Bumped most dependencies within their existing semver ranges (`axios`,
  `expo`, `metro`, `nostr-tools`, `@scure/*`, `react-native-maps`,
  `@kaleidorg/mind`, `@kaleidorg/kaleido-ui`, `kaleido-sdk`, `@qvac/sdk`,
  and others).
- Realigned `react`, `react-dom`, `react-native`, `react-native-svg`,
  `react-native-webview`, `react-native-worklets`, `expo-haptics`, and
  `@react-native-community/netinfo` to Expo SDK 54's compatibility matrix
  via `expo install --fix` (some of these are older patches than what was
  installed — that's the SDK-recommended pairing, not a regression).
- Added `zod` and `light-bolt11-decoder` as explicit dependencies — both
  were already imported directly in the code but only worked before as
  undeclared, incidentally-hoisted transitive dependencies.

### Notes
- `@kaleidorg/wallet-engine` intentionally stays pinned at `beta.55`. A
  newer `beta.63` is available and satisfies the existing semver range, but
  it expects newer peer versions of `@kaleidorg/wdk-wallet-liquid`,
  `@kaleidorg/wdk-wallet-rln`, `@kaleidorg/wdk-protocol-swap-kaleidoswap`,
  and `@arkade-os/wdk` that this app doesn't carry yet — advancing the whole
  protocol stack together should be its own change.
- The regenerated `qvac/worker.bundle.js` / `qvac/addons.manifest.json` now
  additionally list `bare-posix` (needed by the bumped `@qvac/sdk`).
  `bare-posix` has no published Android prebuild yet, relying on the NDK
  toolchain (provisioned in `release.yml`) to build it from source on
  Android CI runs — not verified on-device as part of this change.

## [0.2.0] — 2026-06-21

First public alpha. Introduces **KaleidoMind**, an on-device (QVAC) AI assistant — in
chat and voice — woven through the multi-protocol KaleidoSwap wallet, plus a wallet,
dashboard, and navigation revamp.

### Added
- **KaleidoMind, on-device AI assistant** (chat + voice) via the QVAC SDK and the
  `@kaleidorg/mind` funnel (fast-path → recipe → agentic), running fully on the phone.
- Model picker including the larger Qwen3 4B/8B on high-RAM phones; the active model is
  shown in the chat and voice headers (model · on device / Desktop).
- `/skill` pinning — choose a skill from the `+` menu or type `/skill-name` so the model
  gets that skill's context for the message.
- Conversational **payments to Nostr contacts**: resolves the contact, fetches its
  Lightning address (`lud16`) live, and LNURL-pays the sats amount, with a confirmation card.
- `list_contacts` tool and a tappable **contact-picker card** (tap to prefill a send).
- **Merchant discovery** via live BTC Map data (v2 elements API, cached), with city
  geocoding (Nominatim) so search works without GPS, and tappable merchant cards.
- Voice mode: pause, markdown-formatted replies, copy message/thinking/full chat,
  structured invoice/merchant cards, and `lightning:` share links.
- Wallet/dashboard: multi-protocol assets and activity, refreshed balances after a
  payment, a time-based greeting, and a redesigned orbit FAB (Swap / Scan / Voice) with a
  shortcut legend.

### Changed
- KaleidoMind is clearly marked **Experimental** across onboarding and headers.
- README rewritten around the multi-protocol + on-device-AI story, with an alpha warning
  and roadmap.

### Fixed
- Voice first-recording reliability: pre-warm Whisper, warm the mic/audio session on open,
  and a mic settle delay so the first utterance is captured.
- The assistant no longer keeps thinking in the background after the voice modal is closed.
- Generate real Lightning (BOLT11) invoices instead of a Spark address.
- Number words → digits ("one satoshi" → 1) and punctuation-tolerant contact matching, so
  payment phrasings extract reliably; "no contact" errors list the real contacts to recover.
- Live BTC Map fetch (replacing flaky Overpass), tappable merchant card actions.
- Visible toasts (solid surface + safe-area spacing) and numerous navigation/UI polish.

## [0.1.0]

Initial internal release.

[Unreleased]: https://github.com/kaleidoswap/Rate/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/kaleidoswap/Rate/compare/v0.9.0...v0.9.1
[0.2.0]: https://github.com/kaleidoswap/Rate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kaleidoswap/Rate/releases/tag/v0.1.0
