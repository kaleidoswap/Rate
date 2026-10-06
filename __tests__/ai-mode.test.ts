import { selectAiMode, MIND_DESKTOP_ENABLED } from '../store/slices/settingsSlice';

const state = (aiMode?: string) => ({ settings: { aiMode } }) as any;

test('desktop mode is paused: a saved "delegate" runs KaleidoMind on this device', () => {
  expect(MIND_DESKTOP_ENABLED).toBe(false);
  expect(selectAiMode(state('delegate'))).toBe('local');
  expect(selectAiMode(state('local'))).toBe('local');
  expect(selectAiMode(state('off'))).toBe('off');
  expect(selectAiMode(state(undefined))).toBe('off');
});
