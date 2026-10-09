import { chatMood, voiceMood, toolResultFlash, meterToLevel, MIND_MOODS, type ChatMoodInput } from './mindMood';
import { PRISMO_BODY_PATH, PRISMO_FACET_PATHS, PRISMO_VERTICES } from './prismoGeometry';

const chat = (over: Partial<ChatMoodInput> = {}): ChatMoodInput => ({
  aiEnabled: true,
  llmStatus: 'ready',
  isGenerating: false,
  isStreamingText: false,
  flash: null,
  ...over,
});

describe('chatMood', () => {
  it('sleeps while the assistant is off or not loaded', () => {
    expect(chatMood(chat({ aiEnabled: false }))).toBe('sleeping');
    expect(chatMood(chat({ llmStatus: 'not_downloaded' }))).toBe('sleeping');
    expect(chatMood(chat({ llmStatus: 'downloaded' }))).toBe('sleeping');
  });

  it('thinks while the model downloads or loads', () => {
    expect(chatMood(chat({ llmStatus: 'downloading' }))).toBe('thinking');
    expect(chatMood(chat({ llmStatus: 'loading' }))).toBe('thinking');
  });

  it('is concerned when the model failed', () => {
    expect(chatMood(chat({ llmStatus: 'error' }))).toBe('concerned');
  });

  it('thinks before the reply streams and speaks while it does', () => {
    expect(chatMood(chat({ isGenerating: true }))).toBe('thinking');
    expect(chatMood(chat({ isGenerating: true, isStreamingText: true }))).toBe('speaking');
  });

  it('is idle when ready, and a flash wins over everything', () => {
    expect(chatMood(chat())).toBe('idle');
    expect(chatMood(chat({ flash: 'happy', isGenerating: true }))).toBe('happy');
    expect(chatMood(chat({ flash: 'concerned', aiEnabled: false }))).toBe('concerned');
  });
});

describe('voiceMood', () => {
  const base = { phase: 'idle' as const, failed: false, loading: false, hasError: false };
  it('maps the voice phases one to one', () => {
    expect(voiceMood(base)).toBe('idle');
    expect(voiceMood({ ...base, phase: 'listening' })).toBe('listening');
    expect(voiceMood({ ...base, phase: 'thinking' })).toBe('thinking');
    expect(voiceMood({ ...base, phase: 'speaking' })).toBe('speaking');
  });
  it('thinks while loading and is concerned on failures or errors', () => {
    expect(voiceMood({ ...base, loading: true })).toBe('thinking');
    expect(voiceMood({ ...base, failed: true, loading: true })).toBe('concerned');
    expect(voiceMood({ ...base, hasError: true })).toBe('concerned');
    expect(voiceMood({ ...base, hasError: true, phase: 'listening' })).toBe('listening');
    expect(voiceMood({ ...base, flash: 'happy', phase: 'thinking' })).toBe('happy');
  });
});

describe('toolResultFlash', () => {
  it('celebrates only confirmed tools that succeeded', () => {
    expect(toolResultFlash({ paymentHash: 'ab' }, true)).toBe('happy');
    expect(toolResultFlash({ balance: 1 }, false)).toBeNull();
  });
  it('is concerned when a tool reports an error', () => {
    expect(toolResultFlash({ error: 'nope' }, true)).toBe('concerned');
    expect(toolResultFlash({ success: false }, false)).toBe('concerned');
  });
});

describe('meterToLevel', () => {
  it('maps dBFS to 0..1', () => {
    expect(meterToLevel(undefined)).toBe(0);
    expect(meterToLevel(-160)).toBe(0);
    expect(meterToLevel(0)).toBe(1);
    expect(meterToLevel(3)).toBe(1);
    const mid = meterToLevel(-20);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(meterToLevel(-10)).toBeGreaterThan(mid);
  });
});

describe('Prismo geometry', () => {
  it('has a closed six-sided body inside the 100 box and six facets', () => {
    expect(MIND_MOODS).toHaveLength(7);
    expect(PRISMO_VERTICES).toHaveLength(6);
    for (const [x, y] of PRISMO_VERTICES) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
    expect(PRISMO_BODY_PATH.startsWith('M')).toBe(true);
    expect(PRISMO_BODY_PATH.endsWith('Z')).toBe(true);
    expect((PRISMO_BODY_PATH.match(/Q/g) ?? []).length).toBe(6);
    expect(PRISMO_FACET_PATHS).toHaveLength(6);
  });
});
