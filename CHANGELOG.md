# Changelog

All notable changes to the KaleidoSwap wallet are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> ⚠️ **Alpha.** KaleidoSwap is under active development and not production-ready.
> The KaleidoMind AI assistant is experimental and can make mistakes — review
> actions before confirming. Use test networks and small amounts only.

## [Unreleased]

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

[Unreleased]: https://github.com/kaleidoswap/Rate/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/kaleidoswap/Rate/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kaleidoswap/Rate/releases/tag/v0.1.0
