// services/qvacTts.ts
//
// On-device QVAC text-to-speech playback. QVACService.synthesizeSpeech returns
// 16-bit PCM samples; here we wrap them in a WAV container, write it to a cache
// file and play it through expo-audio. If QVAC TTS is unavailable or fails, the
// caller falls back to the system voice (services/speech.ts).

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
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

let currentSound: AudioPlayer | null = null;

const LIGHTNING_INVOICE_RE = /\b(?:lightning:)?ln(?:bc|tb|bcrt)[a-z0-9]{40,}\b/gi;
const LNURL_RE = /\blnurl[0-9a-z]{40,}\b/gi;

function redactMachineReadablePaymentText(text: string): string {
  return text
    .replace(LIGHTNING_INVOICE_RE, 'Lightning invoice')
    .replace(LNURL_RE, 'Lightning payment link')
    .replace(/\b(?:invoice|payment request|qr_data|qr code)\s*[:=]\s*["']?Lightning invoice["']?/gi, 'invoice')
    .replace(/\b(?:invoice|payment request|qr_data|qr code)\s*[:=]\s*["']?Lightning payment link["']?/gi, 'payment link');
}

function sanitizeForSupertonic(text: string): string {
  return redactMachineReadablePaymentText(text)
    // Strip Markdown/code formatting characters that Supertonic rejects or
    // reads awkwardly. U+0060 (`) is a known native preprocessing failure.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[`*_~#<>|[\]{}]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[•·]/g, '. ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Force the iOS/Android audio session into PLAYBACK-to-SPEAKER mode.
 *
 * This must run before every utterance: the voice recorder leaves the session
 * in PlayAndRecord, which (a) routes audio to the earpiece, not the speaker,
 * and (b) applies voice-processing that makes speech sound thin/robotic. Setting
 * `allowsRecording: false` switches the category back to Playback (loud
 * speaker, no processing). Not cached — recording can flip it back at any time.
 */
async function setSpeakerPlaybackMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      // doNotMix: speak exclusively/clearly (matches the prior iOS DoNotMix; the
      // unified mode now applies on Android too, where it was DuckOthers before).
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    /* non-fatal */
  }
}

/** Stop any in-flight QVAC TTS playback. */
export async function stopQvacSpeak(): Promise<void> {
  const s = currentSound;
  currentSound = null;
  if (s) {
    // expo-audio: pause() halts playback, remove() frees the native player.
    try { s.pause(); } catch { /* ignore */ }
    try { s.remove(); } catch { /* ignore */ }
  }
}

/**
 * Speak `text` with on-device QVAC TTS, resolving when playback finishes.
 * Returns false if QVAC TTS isn't available (so the caller can fall back).
 */
async function qvacSpeak(text: string): Promise<boolean> {
  const speakable = sanitizeForSupertonic(text);
  if (!speakable) return false;

  const synth = await QVACService.getInstance().synthesizeSpeech(speakable);
  if (!synth || !synth.pcm?.length) return false;

  const wav = pcmToWav(synth.pcm, synth.sampleRate);

  const dir = new Directory(Paths.cache, 'qvac-tts');
  try { if (!dir.exists) dir.create({ intermediates: true } as any); } catch { /* exists */ }
  const file = new File(dir, 'speech.wav');
  try { if (file.exists) file.delete(); } catch { /* ignore */ }
  file.write(wav);

  await setSpeakerPlaybackMode();
  await stopQvacSpeak();

  const sound = createAudioPlayer({ uri: file.uri });
  currentSound = sound;
  sound.play();

  return new Promise<boolean>((resolve) => {
    const sub = sound.addListener('playbackStatusUpdate', (status) => {
      if (!status.isLoaded) return;
      if (status.didJustFinish) {
        sub.remove();
        try { sound.remove(); } catch { /* already freed */ }
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
  // Route to the loud speaker (not the earpiece) before anything plays — covers
  // both the SUPERTONIC path and the system-voice fallback below.
  await setSpeakerPlaybackMode();
  // Honour the user's TTS engine choice: 'system' skips the neural voice
  // entirely (no download, instant) and goes straight to the OS synthesiser.
  const engine = QVACService.getInstance().getTtsEngine();
  if (engine !== 'system') {
    try {
      const ok = await qvacSpeak(text);
      if (ok) {
        done();
        return;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('text preprocessing failed') || message.includes('unsupported character')) {
        console.log('[QVAC] TTS: Supertonic rejected text; using system voice for this reply');
      } else {
        console.warn('[QVAC] TTS failed, using system voice:', message);
      }
    }
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
