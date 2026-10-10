# Prismo — original 2D animation

The directory retains the prototype name; the active renderer is 2D and preserves the approved original artwork.

Run from the repository root:

```sh
python3 -m http.server 4321 --bind 127.0.0.1 --directory preview/prismo-3d
```

Open http://127.0.0.1:4321 and start the demo. Audio requires a user gesture.
No microphone or wallet data is used. The Italian example uses prerecorded synthetic speech, with character timings and audio energy driving approximate mouth shapes.

`animate-original.js` renders one continuous textured WebGL surface. The shoulder remains anchored; the hand and lips deform smoothly without detached cutouts or skin patches. Blinking blends the aligned eye texture. Reduced motion disables ambient breathing and automatic blinks.

Native integration:

- `python3 scripts/build-prismo-renderer.py` regenerates the audio-free native renderer from the same mesh and shaders.
- `python3 scripts/build-prismo-talk-preview.py` regenerates the offline development preview.
- `PrismoAnimatedCharacter` loads bundled artwork and receives only phase and playback energy. Native Talk uses real TTS playback events: PCM energy for QVAC and word boundaries for the system voice. This is approximate lip sync, not phoneme animation.
- The welcome screen replays the greeting on entry. Backgrounding pauses animation; Talk stops playback on pause and close.

The simulator verifies the UI and system voice. Local QVAC conversation and performance still require physical-device validation.
