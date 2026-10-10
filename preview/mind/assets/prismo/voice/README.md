# Prismo Italian voice demo

Five prerecorded synthetic clips generated with ElevenLabs Multilingual v2.
Prismo uses Will; the prerecorded user question uses Sarah. Exact text and
settings are in generate.py. Credentials are read only from the environment.

clips.json stores 25 ms RMS amplitude frames measured from each decoded MP3.
The preview reads the envelope at the audio element's currentTime, smooths it,
and drives MindCharacter's optional speechLevel value (0 closed, 1 open).
This synchronizes mouth opening with speech energy and silence, not phonemes.
The app's native TTS pipeline is not connected to this preview audio player.

Playback completion advances the demo, except payment approval, which always
requires the explicit confirmation button. Editing the amount stops narration.
Pause, mute, retry, page changes and unmount stop or control the owned player.
The question is prerecorded; no microphone or wallet is accessed.

Regenerate intentionally with python3 generate.py after removing only the
specific MP3 to replace; existing files are reused to avoid duplicate charges.
