import { voiceStatus, type VoiceStatusInput } from './voiceStatus';
const state: VoiceStatusInput = { enabled: true, model: 'Qwen', llmStatus: 'ready', whisperStatus: 'ready', modelProgress: 20, speechProgress: 30, starting: false, phase: 'idle' };
it('requires both models to be ready before advertising readiness', () => {
  expect(voiceStatus(state).ready).toBe(true);
  expect(voiceStatus({ ...state, whisperStatus: 'loading' })).toMatchObject({ ready: false, subtitle: 'Qwen · not ready', status: 'Loading speech recognition…' });
  expect(voiceStatus({ ...state, enabled: false }).subtitle).toBe('Agent is off');
});
it('distinguishes download, microphone startup, listening and a denied permission', () => {
  expect(voiceStatus({ ...state, llmStatus: 'downloading' }).status).toContain('20%');
  expect(voiceStatus({ ...state, starting: true }).status).toBe('Starting microphone…');
  expect(voiceStatus({ ...state, phase: 'listening' }).status).toBe('Listening…');
  expect(voiceStatus({ ...state, error: 'Microphone permission denied' }).status).toContain('device Settings');
});
