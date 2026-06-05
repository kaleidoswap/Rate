// services/qvacTts.ts
//
// On-device QVAC text-to-speech playback. QVACService.synthesizeSpeech returns
// 16-bit PCM samples; here we wrap them in a WAV container, write it to a cache
// file and play it through expo-av. If QVAC TTS is unavailable or fails, the
// caller falls back to the system voice (services/speech.ts).

import { Audio } from 'expo-av';
import { File, Directory, Paths } from 'expo-file-system';
import { Buffer } from 'buffer';
import QVACService from './QVACService';
import { speakBest, stopSpeaking } from './speech';

// Build a 16-bit mono PCM WAV from raw samples.
function pcmToWav(samples: number[], sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // audio format = PCM
  buf.writeUInt16LE(1, 22); // channels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * channels * bytesPerSample)
  buf.writeUInt16LE(2, 32); // block align (channels * bytesPerSample)
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    let s = samples[i] | 0;
    if (s > 32767) s = 32767;
    else if (s < -32768) s = -32768;
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return new Uint8Array(buf);
}

let currentSound: Audio.Sound | null = null;
let audioModeSet = false;

async function ensureAudioMode(): Promise<void> {
  if (audioModeSet) return;
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false });
    audioModeSet = true;
  } catch {
    /* non-fatal */
  }
}

/** Stop any in-flight QVAC TTS playback. */
export async function stopQvacSpeak(): Promise<void> {
  const s = currentSound;
  currentSound = null;
  if (s) {
    try { await s.stopAsync(); } catch { /* ignore */ }
    try { await s.unloadAsync(); } catch { /* ignore */ }
  }
}

/**
 * Speak `text` with on-device QVAC TTS, resolving when playback finishes.
 * Returns false if QVAC TTS isn't available (so the caller can fall back).
 */
async function qvacSpeak(text: string): Promise<boolean> {
  const synth = await QVACService.getInstance().synthesizeSpeech(text);
  if (!synth || !synth.pcm?.length) return false;

  const wav = pcmToWav(synth.pcm, synth.sampleRate);

  const dir = new Directory(Paths.cache, 'qvac-tts');
  try { if (!dir.exists) dir.create({ intermediates: true } as any); } catch { /* exists */ }
  const file = new File(dir, 'speech.wav');
  try { if (file.exists) file.delete(); } catch { /* ignore */ }
  file.write(wav);

  await ensureAudioMode();
  await stopQvacSpeak();

  const { sound } = await Audio.Sound.createAsync({ uri: file.uri }, { shouldPlay: true });
  currentSound = sound;

  return new Promise<boolean>((resolve) => {
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (!status?.isLoaded) return;
      if (status.didJustFinish) {
        void sound.unloadAsync();
        if (currentSound === sound) currentSound = null;
        resolve(true);
      }
    });
  });
}

export interface SpeakCallbacks {
  onDone?: () => void;
  onError?: () => void;
}

/**
 * Speak with QVAC on-device TTS; transparently fall back to the best system
 * voice if QVAC TTS is unavailable or errors. Always invokes onDone when audio
 * finishes (either path).
 */
export async function speak(text: string, cb: SpeakCallbacks = {}): Promise<void> {
  const done = () => cb.onDone?.();
  try {
    const ok = await qvacSpeak(text);
    if (ok) {
      done();
      return;
    }
  } catch (e) {
    console.warn('[QVAC] TTS failed, using system voice:', e instanceof Error ? e.message : String(e));
  }
  // Fallback: system voice.
  try {
    await speakBest(text, { onDone: done, onStopped: done, onError: done });
  } catch {
    done();
  }
}

/** Stop both QVAC and system-voice playback. */
export async function stopSpeak(): Promise<void> {
  stopSpeaking();
  await stopQvacSpeak();
}
