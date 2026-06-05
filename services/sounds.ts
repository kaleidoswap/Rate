// services/sounds.ts
//
// Lightweight UI sound-effects engine. Instead of shipping binary audio assets,
// we SYNTHESISE a small palette of short, pleasant chimes on-device the first
// time each one is needed: render 16-bit PCM → wrap in a WAV container (same
// trick as services/qvacTts.ts) → cache the file → preload an expo-av Sound and
// replay it on demand. Synthesised tones keep the bundle tiny and let the sounds
// stay perfectly on-brand (bright, musical, never harsh).
//
// These are deliberately quiet, sub-400ms blips meant to ACCOMPANY haptics — see
// utils/feedback.ts, which fires both together so the wallet is legible through
// sound and touch, not sight alone. UI sounds respect the hardware mute switch
// (playsInSilentModeIOS is left at its default of false) so they never surprise
// anyone in a meeting.

import { Audio } from 'expo-av';
import { File, Directory, Paths } from 'expo-file-system';
import { Buffer } from 'buffer';

const SAMPLE_RATE = 44100;

// A single tone in a sound: a frequency held for a duration, at a relative gain.
interface Segment {
  freq: number; // Hz
  dur: number; // seconds
  gain?: number; // 0..1 relative loudness (default 1)
  delay?: number; // seconds of silence BEFORE this segment (default 0)
}

export type SoundKey =
  | 'tap' // light press / button
  | 'select' // toggle, picker tick
  | 'success' // generic completion
  | 'error' // failure
  | 'warning' // caution
  | 'send' // payment sent (descending)
  | 'receive' // payment received (coin, ascending)
  | 'swap'; // swap completed (playful up-interval)

// ─────────────────────────────────────────────────────────────────────────
// CUSTOM SOUNDS (optional overrides)
// ---------------------------------------------------------------------------
// Drop your own audio files (mp3 / m4a / wav — keep them short, < ~500ms, mono,
// normalised to roughly -1 dBFS) into `assets/sounds/`, then uncomment the
// matching line(s) below. Any key with a custom asset uses that file instead of
// the synthesised chime; keys left commented keep the built-in tone. No other
// code changes needed — the loader and the user's "Sound effects" setting still
// apply. (Metro bundles these at build time, so the require path must resolve.)
//
//   const tapSfx = require('../assets/sounds/tap.mp3');
//
const CUSTOM_SOUNDS: Partial<Record<SoundKey, number>> = {
  tap: require('../assets/sounds/tap.wav'),
  select: require('../assets/sounds/select.wav'),
  success: require('../assets/sounds/success.wav'),
  error: require('../assets/sounds/error.wav'),
  warning: require('../assets/sounds/warning.wav'),
  send: require('../assets/sounds/send.wav'),
  receive: require('../assets/sounds/receive.wav'),
  swap: require('../assets/sounds/swap.wav'),
};

// Custom files play at their own recorded level (the MASTER_GAIN attenuation
// only applies to the synthesised path). Tame them so they sit at roughly the
// same loudness as the rest of the UI rather than blasting at full scale.
const CUSTOM_SOUND_VOLUME = 0.6;

// Master attenuation — these are background blips, not alarms.
const MASTER_GAIN = 0.32;

// Musical note frequencies (equal temperament) used by the palette.
const A3 = 220.0;
const E4 = 329.63;
const A4 = 440.0;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880.0;
const B5 = 987.77;
const C6 = 1046.5;
const E6 = 1318.51;

// Each sound is a sequence of bell-like tones. Kept short and consonant.
const PALETTE: Record<SoundKey, Segment[]> = {
  tap: [{ freq: A5, dur: 0.05, gain: 0.5 }],
  select: [{ freq: E6, dur: 0.04, gain: 0.45 }],
  // Bright ascending major triad — feels like "done, all good".
  success: [
    { freq: C5, dur: 0.1 },
    { freq: E5, dur: 0.1 },
    { freq: G5, dur: 0.22 },
  ],
  // Low, gentle descending minor third — clearly "off" without being jarring.
  error: [
    { freq: A3, dur: 0.14, gain: 0.9 },
    { freq: E4, dur: 0.001, gain: 0 }, // tiny gap
    { freq: A3 * 0.84, dur: 0.22, gain: 0.9 },
  ],
  // Two equal mid beeps — "pay attention" without alarm.
  warning: [
    { freq: A4, dur: 0.09 },
    { freq: A4, dur: 0.12, delay: 0.05 },
  ],
  // Soft downward step — value leaving the wallet.
  send: [
    { freq: G5, dur: 0.09 },
    { freq: C5, dur: 0.2 },
  ],
  // Sparkly upward "coin" — value arriving.
  receive: [
    { freq: G5, dur: 0.08 },
    { freq: C6, dur: 0.1 },
    { freq: E6, dur: 0.2, gain: 0.85 },
  ],
  // Playful rising fifth then octave — the swap "lands".
  swap: [
    { freq: E5, dur: 0.08 },
    { freq: B5, dur: 0.09 },
    { freq: E6, dur: 0.18, gain: 0.85 },
  ],
};

// Render a segment list to mono float samples in [-1, 1].
// Each tone gets a fast attack and an exponential decay so it reads as a
// plucked bell rather than a flat beep, plus a quiet 2nd harmonic for shimmer.
function renderSegments(segments: Segment[]): number[] {
  const out: number[] = [];
  for (const seg of segments) {
    if (seg.delay && seg.delay > 0) {
      const silent = Math.floor(seg.delay * SAMPLE_RATE);
      for (let i = 0; i < silent; i++) out.push(0);
    }
    const n = Math.max(1, Math.floor(seg.dur * SAMPLE_RATE));
    const gain = seg.gain ?? 1;
    const w = 2 * Math.PI * seg.freq;
    const attack = Math.min(0.006, seg.dur * 0.4) * SAMPLE_RATE; // ~6ms ramp-in
    const decayK = 5.5; // higher = faster decay → pluckier
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const attackEnv = i < attack ? i / attack : 1;
      const decayEnv = Math.exp(-decayK * t);
      const env = attackEnv * decayEnv;
      const fundamental = Math.sin(w * t);
      const harmonic = 0.28 * Math.sin(2 * w * t);
      out.push(gain * env * (fundamental + harmonic));
    }
  }
  return out;
}

// Float samples → 16-bit PCM mono WAV bytes.
function floatToWav(samples: number[]): Uint8Array {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    let s = Math.round(samples[i] * MASTER_GAIN * 32767);
    if (s > 32767) s = 32767;
    else if (s < -32768) s = -32768;
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return new Uint8Array(buf);
}

class SoundEngine {
  private enabled = true;
  private sounds = new Map<SoundKey, Audio.Sound>();
  private loading = new Map<SoundKey, Promise<Audio.Sound | null>>();

  /** Mirror the user's "Sound effects" setting. */
  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private cacheDir(): Directory {
    const dir = new Directory(Paths.cache, 'ui-sounds');
    try {
      if (!dir.exists) dir.create({ intermediates: true } as any);
    } catch {
      /* already exists */
    }
    return dir;
  }

  // Load an expo-av Sound for a key. Prefers a bundled CUSTOM_SOUNDS asset
  // (e.g. an AI-generated .mp3); otherwise synthesises the built-in chime once
  // and caches the WAV. Both paths are cached in `this.sounds` after first load.
  private async load(key: SoundKey): Promise<Audio.Sound | null> {
    const existing = this.sounds.get(key);
    if (existing) return existing;
    const inflight = this.loading.get(key);
    if (inflight) return inflight;

    const p = (async () => {
      try {
        const custom = CUSTOM_SOUNDS[key];
        let source: any;
        let volume = 1.0;
        if (custom != null) {
          // A require()'d audio asset (number/module ref) — expo-av loads it directly.
          source = custom;
          volume = CUSTOM_SOUND_VOLUME;
        } else {
          // No custom file: synthesise the chime to a cached WAV.
          const file = new File(this.cacheDir(), `${key}.wav`);
          if (!file.exists) {
            const wav = floatToWav(renderSegments(PALETTE[key]));
            file.write(wav);
          }
          source = { uri: file.uri };
        }
        const { sound } = await Audio.Sound.createAsync(source, {
          shouldPlay: false,
          volume,
        });
        this.sounds.set(key, sound);
        return sound;
      } catch {
        return null; // audio is a nice-to-have; never throw into the UI
      } finally {
        this.loading.delete(key);
      }
    })();
    this.loading.set(key, p);
    return p;
  }

  /** Play a UI sound. No-op (and never throws) when disabled or on failure. */
  async play(key: SoundKey): Promise<void> {
    if (!this.enabled) return;
    try {
      const sound = await this.load(key);
      if (!sound) return;
      await sound.replayAsync();
    } catch {
      /* ignore — sound is non-critical */
    }
  }

  /** Warm the cache so the first interaction isn't delayed by synthesis. */
  async preload(keys: SoundKey[] = ['tap', 'success', 'error']): Promise<void> {
    await Promise.all(keys.map((k) => this.load(k)));
  }
}

export const soundEngine = new SoundEngine();
