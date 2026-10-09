export type MindMood =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'concerned'
  | 'sleeping';

export const MIND_MOODS: readonly MindMood[] = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'concerned',
  'sleeping',
];

/** One-shot moods shown briefly after an outcome, then back to the state mood. */
export type MindFlash = 'happy' | 'concerned' | null;

export const MIND_FLASH_MS = 1600;

export type ModelLoadStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'downloaded'
  | 'loading'
  | 'ready'
  | 'error';

export interface ChatMoodInput {
  aiEnabled: boolean;
  llmStatus: ModelLoadStatus;
  isGenerating: boolean;
  /** Reply tokens are arriving (vs. reasoning / running tools). */
  isStreamingText: boolean;
  flash?: MindFlash;
}

export function chatMood(i: ChatMoodInput): MindMood {
  if (i.flash) return i.flash;
  if (!i.aiEnabled) return 'sleeping';
  if (i.llmStatus === 'error') return 'concerned';
  if (i.isGenerating) return i.isStreamingText ? 'speaking' : 'thinking';
  if (i.llmStatus === 'downloading' || i.llmStatus === 'loading') return 'thinking';
  if (i.llmStatus !== 'ready') return 'sleeping';
  return 'idle';
}

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface VoiceMoodInput {
  phase: VoicePhase;
  failed: boolean;
  loading: boolean;
  hasError: boolean;
  flash?: MindFlash;
}

export function voiceMood(i: VoiceMoodInput): MindMood {
  if (i.flash) return i.flash;
  if (i.failed) return 'concerned';
  if (i.loading) return 'thinking';
  if (i.phase !== 'idle') return i.phase;
  return i.hasError ? 'concerned' : 'idle';
}

/**
 * Outcome of a tool call for the character: a failed tool looks concerned, a
 * confirmed (money) tool that succeeded looks happy, anything else is neutral.
 */
export function toolResultFlash(result: unknown, confirmed: boolean): MindFlash {
  const failed =
    typeof result === 'object' &&
    result !== null &&
    ('error' in result || (result as { success?: unknown }).success === false);
  if (failed) return 'concerned';
  return confirmed ? 'happy' : null;
}

/** dBFS from the recorder's meter → 0..1 loudness. */
export function meterToLevel(db: number | undefined | null, floor = -55): number {
  if (db == null || !Number.isFinite(db)) return 0;
  if (db >= 0) return 1;
  if (db <= floor) return 0;
  const t = (db - floor) / -floor;
  return t * t;
}
