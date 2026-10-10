# Prismo release validation — 2026-10-10

## Changes

- Talk reads the saved `mindConfig.voiceLanguage` (Italian by default), independently of the app language. Models & voice now exposes the choice and explains the system-voice fallback for non-English output.
- Voice startup is cancellable across model initialization, permission, audio setup and native session creation. Pause, close and backgrounding invalidate startup; a late native session is destroyed before capture starts. Late callbacks cannot restart a stopped session.
- One-shot recording also cancels pending permission/preparation and discards transcription results arriving after Pause or close.
- Talk distinguishes disabled, downloading, loading, microphone startup, listening and speaking. Only both ready models produce a ready subtitle. Production status text follows the current English UI; spoken language is separate.
- Prismo keeps the original textures. Render resolution follows visible size at up to 2× density (640 px cap), geometry uses 96×96 cells, and drawing is limited to 30 fps. Reduced-motion idle rendering stops after one settled frame; background rendering pauses. A failed renderer falls back to the original static image.

The 208-point Talk character renders at most 416×416 pixels instead of 1280×1280: approximately 89% fewer framebuffer pixels per draw. The 96×96 mesh has 64% fewer triangles. These are workload reductions, not measured battery or physical-device FPS claims.

## Dependency assessment

GitHub advisories currently report no patched versions for:

| Dependency | Advisory | Installed dependency path |
| --- | --- | --- |
| node-forge 1.4.0 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI and Expo code-signing tools |
| braces 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Jest transform / micromatch (build tools) |
| sprintf-js 1.0.3 | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | Jest coverage / js-yaml / argparse (build tools) |

The production Android and iOS source maps were inspected (5,511 Android and 5,510 iOS source entries): none of these packages is included. CI now exports source maps for both Android and iOS and fails if any enters the mobile graph, or if maps are missing. Maps are validation artifacts, not committed app assets. This does not patch the tools or resolve the Dependabot alerts; build-tool exposure remains. No alerts were dismissed and no unsupported dependency replacement was installed.

## Automated and simulator results

- 226 Jest suites / 1,722 tests passed; coverage remains above the repository floor.
- TypeScript completed without errors.
- 9 Node regression checks passed, including the bundle-dependency scanner.
- Android and iOS production JavaScript/Hermes exports succeeded. This is not a signed native build.
- Simulator: original Prismo appearance, Italian system speech, and truthful Agent-off/speaking status were checked visually.

## Physical-device acceptance — pending

The connected-device inventory showed the iPhone offline and no Android available. The user chose to run these tests with the next release. Simulator speech and unit tests do not validate native QVAC or device battery use.

- [ ] iPhone and Android: first setup, download, cold start and full voice turn in Italian.
- [ ] Pause during model load / permission prompt / microphone startup; granting permission later must not start capture.
- [ ] Close Talk while starting or speaking; return to chat without recording or playback continuing.
- [ ] Send app to background / lock screen during startup and speech; on return it remains paused until explicitly resumed.
- [ ] Deny microphone permission; show an actionable message, then recover after granting access in OS Settings.
- [ ] Switch voice language; restart app and check persistence and pronunciation.
- [ ] Speaker and Bluetooth/wired headphones: input and output routing, no self-transcription or feedback.
- [ ] Test wallet: balance → prepare payment → review recipient, amount and fees → cancel; separately test explicit approval and biometric/PIN cancellation. No payment should be authorized by speech alone.
- [ ] Smaller / lower-memory phones: model selection, memory pressure, crystal animation clarity and a sustained Talk session for responsiveness and temperature.
- [ ] Reduced motion and large accessibility text: no hidden payment details or inaccessible Pause control.

No signed build, store release or financial transaction was performed during this validation.
