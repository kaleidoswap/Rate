# UI sound effects

Optional custom audio for the wallet's interaction sounds. If this folder is
empty, the app **synthesises** pleasant chimes at runtime (see
`services/sounds.ts`) — no files are required.

To use your own sounds, drop files here and uncomment the matching line in the
`CUSTOM_SOUNDS` map in `services/sounds.ts`.

## Sound keys

| Key       | Fires on                              | Feel                              |
|-----------|---------------------------------------|-----------------------------------|
| `tap`     | Button / action-tile press            | Tiny, soft, neutral               |
| `select`  | Toggle, picker, copy, route choice    | Crisp tick                        |
| `success` | Generic completion (e.g. invoice made)| Bright, resolved, positive        |
| `error`   | Failed payment / swap, validation     | Low, gentle "no" — never harsh    |
| `warning` | Quote expiring, low balance           | Two-note "attention", not alarm   |
| `send`    | Payment sent                          | Soft downward — value leaving     |
| `receive` | Payment received                      | Sparkly upward "coin" — arriving  |
| `swap`    | Swap completed                        | Playful upward — it "lands"       |

## File requirements

- **Format:** `.mp3`, `.m4a`/`.aac`, or `.wav` (expo-av plays all three).
- **Length:** keep under ~500 ms. These accompany haptics; long tails feel laggy.
- **Channels:** mono is fine and smaller.
- **Level:** normalise to about −1 dBFS, then the engine attenuates to ~0.32.
- **No reverb tails / no silence padding** at the start (adds perceived latency).
- **Naming:** `<key>.<ext>`, e.g. `receive.mp3`, `error.m4a`.

## Licensing

Only ship audio you have the right to distribute (your own, AI-generated with a
commercial license, or CC0). Note the source in your commit.
