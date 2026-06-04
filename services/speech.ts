// services/speech.ts
//
// Thin wrapper over expo-speech that speaks with the BEST available system
// voice instead of the bland default. iOS/Android ship multiple voices of
// different quality (Default → Enhanced → Premium); the platform default is
// usually the robotic "compact" one. We enumerate the installed voices once and
// pick the highest-quality match for the requested language, which is a big
// perceptual upgrade with zero extra assets.
//
// Users can install even better (Premium/Siri) voices in OS settings; when
// present they're automatically preferred.

import * as Speech from 'expo-speech';

export interface SpeakOptions {
  language?: string; // BCP-47, e.g. 'en-US'. Default 'en-US'.
  rate?: number; // expo-speech rate (1.0 = normal).
  pitch?: number;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e?: unknown) => void;
}

let _voicesPromise: Promise<Speech.Voice[]> | null = null;
const _bestVoiceCache = new Map<string, string | undefined>();

function loadVoices(): Promise<Speech.Voice[]> {
  if (!_voicesPromise) {
    _voicesPromise = Speech.getAvailableVoicesAsync().catch(() => [] as Speech.Voice[]);
  }
  return _voicesPromise;
}

// Rank a voice for a target language. Higher is better. -1 = not a match.
function scoreVoice(v: Speech.Voice, lang: string): number {
  const langPrefix = lang.split('-')[0].toLowerCase();
  const vLang = (v.language || '').toLowerCase();
  if (!vLang.startsWith(langPrefix)) return -1;

  let score = 0;
  // Exact locale match (en-US vs en-GB) is nicer.
  if (vLang === lang.toLowerCase()) score += 5;

  // Quality tier: Enhanced/Premium >> Default.
  const q = String(v.quality || '').toLowerCase();
  if (q.includes('premium')) score += 40;
  else if (q.includes('enhanced')) score += 30;

  // Identifier hints — premium/enhanced/Siri/neural voices sound best.
  const id = (v.identifier || '').toLowerCase();
  const name = (v.name || '').toLowerCase();
  if (id.includes('premium') || name.includes('premium')) score += 20;
  if (id.includes('enhanced') || name.includes('enhanced')) score += 12;
  if (id.includes('siri')) score += 18;
  if (id.includes('neural')) score += 15;
  // Avoid the obviously low-fi "compact" bundles when better exist.
  if (id.includes('compact')) score -= 8;
  if (id.includes('eloquence')) score -= 12; // legacy robotic voices

  return score;
}

async function bestVoiceId(lang: string): Promise<string | undefined> {
  if (_bestVoiceCache.has(lang)) return _bestVoiceCache.get(lang);
  const voices = await loadVoices();
  let best: Speech.Voice | undefined;
  let bestScore = -1;
  for (const v of voices) {
    const s = scoreVoice(v, lang);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  const id = bestScore >= 0 ? best?.identifier : undefined;
  _bestVoiceCache.set(lang, id);
  return id;
}

/**
 * Speak text with the best available voice. Resolves the voice asynchronously
 * but starts speaking as soon as it's chosen; falls back to the system default
 * if enumeration fails.
 */
export async function speakBest(text: string, opts: SpeakOptions = {}): Promise<void> {
  const language = opts.language ?? 'en-US';
  const voice = await bestVoiceId(language);
  Speech.speak(text, {
    language,
    voice, // undefined → system default
    // A touch slower than 1.0 reads more naturally for assistant replies.
    rate: opts.rate ?? 0.96,
    pitch: opts.pitch ?? 1.0,
    onDone: opts.onDone,
    onStopped: opts.onStopped,
    onError: opts.onError,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
