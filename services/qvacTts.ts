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
let generation = 0;
let cancelPlayback: (() => void) | null = null;

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
  cancelPlayback?.();
  cancelPlayback = null;
  const sound = currentSound;
  currentSound = null;
  try { sound?.pause(); } catch {}
  try { sound?.remove(); } catch {}
}

export interface SpeakCallbacks {
  language?: string;
  onStart?: () => void;
  /** Audio energy (QVAC) or a word-boundary pulse (system voice), 0…1. */
  onLevel?: (level: number) => void;
  onDone?: () => void;
  onError?: () => void;
}

async function qvacSpeak(text: string, token: number, cb: SpeakCallbacks): Promise<boolean> {
  const speakable = sanitizeForSupertonic(text);
  if (!speakable) return false;
  const synth = await QVACService.getInstance().synthesizeSpeech(speakable);
  if (token !== generation) return true;
  if (!synth?.pcm?.length) return false;
  const wav = pcmToWav(synth.pcm, synth.sampleRate);
  const dir = new Directory(Paths.cache, 'qvac-tts');
  if (!dir.exists) dir.create({ intermediates: true });
  const file = new File(dir, `speech-${token}.wav`);
  file.write(wav);
  const sound = createAudioPlayer({ uri: file.uri }, { updateInterval: 40 });
  currentSound = sound;
  return new Promise<boolean>((resolve, reject) => {
    let settled = false, started = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; sub.remove(); clearTimeout(watchdog);
      if (currentSound === sound) { currentSound = null; cancelPlayback = null; }
      try { sound.pause(); sound.remove(); } catch {}
      try { file.delete(); } catch {}
      cb.onLevel?.(0);
      if (error) reject(error); else resolve(true);
    };
    const sub = sound.addListener('playbackStatusUpdate', status => {
      if (token !== generation) { finish(); return; }
      if (status.playing) {
        if (!started) { started = true; cb.onStart?.(); }
        const start = Math.floor(status.currentTime * synth.sampleRate);
        const end = Math.min(synth.pcm.length, start + Math.ceil(synth.sampleRate * .025));
        let energy = 0;
        for (let i = start; i < end; i++) energy += (synth.pcm[i] / 32768) ** 2;
        const rms = Math.sqrt(energy / Math.max(1, end - start));
        cb.onLevel?.(Math.min(1, Math.max(0, (rms - .006) * 12)));
      } else cb.onLevel?.(0);
      if (status.didJustFinish) finish();
    });
    const watchdog = setTimeout(() => finish(new Error('TTS playback timed out')), synth.pcm.length / synth.sampleRate * 1000 + 15000);
    cancelPlayback = () => finish();
    try { sound.play(); } catch (error) { finish(error); }
  });
}

/** On-device playback; non-English uses the installed system voice because
 * the bundled QVAC Supertonic model is English-only. No cloud calls. */
export async function speak(text: string, cb: SpeakCallbacks = {}): Promise<void> {
  const token = ++generation;
  stopSpeaking();
  await stopQvacSpeak();
  await setSpeakerPlaybackMode();
  if (token !== generation) return;
  const live = () => token === generation;
  const done = () => { if (live()) { cb.onLevel?.(0); cb.onDone?.(); } };
  const language = cb.language ?? 'en-US';
  const engine = QVACService.getInstance().getTtsEngine();
  if (engine !== 'system' && language.toLowerCase().startsWith('en')) {
    try {
      if (await qvacSpeak(text, token, { ...cb, onLevel: n => { if(live()) cb.onLevel?.(n); }, onStart: () => {if(live())cb.onStart?.();} })) { done(); return; }
    } catch { /* Use system synthesis when the local model/player fails. */ }
  }
  if (!live()) return;
  let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => { clearTimeout(boundaryTimer); done(); };
  try {
    await speakBest(redactMachineReadablePaymentText(text), {
      language,
      onStart: () => {if(live())cb.onStart?.();},
      onBoundary: event => {
        if (!live()) return;
        clearTimeout(boundaryTimer); cb.onLevel?.(.75);
        boundaryTimer = setTimeout(() => {if(live())cb.onLevel?.(0);}, Math.min(180, Math.max(70,event.charLength*25)));
      },
      onDone: finish,
      onStopped: finish,
      onError: () => {clearTimeout(boundaryTimer);if(live()){cb.onLevel?.(0);cb.onError?.();}},
    });
  } catch { if(live()){cb.onLevel?.(0);cb.onError?.();} }
}

export async function stopSpeak(): Promise<void> {
  generation++;
  stopSpeaking();
  await stopQvacSpeak();
}
