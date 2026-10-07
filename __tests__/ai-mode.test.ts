import { selectAiMode } from '../store/slices/settingsSlice';

const state = (aiMode?: string) => ({ settings: { aiMode } }) as any;

test('a saved "delegate" from the removed desktop mode runs KaleidoMind on this device', () => {
  expect(selectAiMode(state('delegate'))).toBe('local');
  expect(selectAiMode(state('local'))).toBe('local');
  expect(selectAiMode(state('off'))).toBe('off');
  expect(selectAiMode(state(undefined))).toBe('off');
});
