import { speak, stopSpeak } from './qvacTts';
import { speakBest } from './speech';
const mockSynth = jest.fn();
let mockEngine = 'system';
const mockRemove = jest.fn();
let mockPlayback: (status: any) => void;
jest.mock('./QVACService', () => ({ __esModule: true, default: { getInstance: () => ({ getTtsEngine: () => mockEngine, synthesizeSpeech: mockSynth }) } }));
jest.mock('./speech', () => ({ speakBest: jest.fn(), stopSpeaking: jest.fn() }));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(), createAudioPlayer: () => ({
  addListener: (_: string, cb: any) => { mockPlayback = cb; return { remove: mockRemove }; }, play: jest.fn(), pause: jest.fn(), remove: mockRemove,
}) }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'cache' }, Directory: class { exists = true; }, File: class { uri = 'test.wav'; write() {} delete() {} } }));
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockEngine = 'system'; });
afterEach(async () => { await stopSpeak(); jest.useRealTimers(); });
it('drives the Italian mouth from actual word callbacks and closes between words', async () => {
  const onLevel = jest.fn(), onDone = jest.fn();
  await speak('Ciao Prismo', { language: 'it-IT', onLevel, onDone });
  const options = (speakBest as jest.Mock).mock.calls[0][1];
  expect(options.language).toBe('it-IT'); expect(onLevel).not.toHaveBeenCalled();
  options.onBoundary({ charIndex: 0, charLength: 4 }); expect(onLevel).toHaveBeenLastCalledWith(.75);
  jest.advanceTimersByTime(100); expect(onLevel).toHaveBeenLastCalledWith(0);
  options.onDone(); expect(onDone).toHaveBeenCalledTimes(1);
});
it('ignores stale voice callbacks after interruption and replacement', async () => {
  const onLevel = jest.fn(), onDone = jest.fn();
  await speak('Prima', { onLevel, onDone });
  const options = (speakBest as jest.Mock).mock.calls[0][1];
  await stopSpeak(); await speak('Nuova');
  options.onBoundary({ charIndex: 0, charLength: 5 }); options.onDone();
  expect(onLevel).not.toHaveBeenCalled(); expect(onDone).not.toHaveBeenCalled();
});
it('uses PCM energy at the playback position, then releases the player', async () => {
  mockEngine = 'qvac'; mockSynth.mockResolvedValue({ sampleRate: 1000, pcm: [...Array(100).fill(0), ...Array(100).fill(6000)] });
  const onLevel = jest.fn(), onStart = jest.fn(), onDone = jest.fn();
  const promise = speak('Hello', { onLevel, onStart, onDone });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  mockPlayback({ playing: true, currentTime: 0 }); expect(onLevel).toHaveBeenLastCalledWith(0);
  mockPlayback({ playing: true, currentTime: .1 }); expect(onLevel).toHaveBeenLastCalledWith(1);
  expect(onStart).toHaveBeenCalledTimes(1);
  mockPlayback({ playing: false, currentTime: .2, didJustFinish: true }); await promise;
  expect(onLevel).toHaveBeenLastCalledWith(0); expect(onDone).toHaveBeenCalledTimes(1); expect(mockRemove).toHaveBeenCalled();
});
