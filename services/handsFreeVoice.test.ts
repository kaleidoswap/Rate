import { startHandsFreeVoice } from './handsFreeVoice';
import { requestRecordingPermissionsAsync } from 'expo-audio';
const mockInit = jest.fn(), mockOpen = jest.fn(), mockMic = jest.fn(), mockLoop = jest.fn();
jest.mock('./QVACService', () => ({ __esModule: true, default: { getInstance: () => ({ initializeWhisper: mockInit, openVoiceSession: mockOpen, getState: () => ({ whisperStatus: 'ready' }) }) } }));
jest.mock('./micStream', () => ({ startMicStream: (...args: any[]) => mockMic(...args) }));
jest.mock('@kaleidorg/mind/qvac', () => ({ runVoiceAssistant: (...args: any[]) => mockLoop(...args) }));
jest.mock('expo-audio', () => ({ requestRecordingPermissionsAsync: jest.fn(), setAudioModeAsync: jest.fn() }));
const deferred = () => { let resolve!: (value?: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
const handlers = { respond: jest.fn(), speak: jest.fn(), onState: jest.fn() };
let session: any, mic: any;
beforeEach(() => {
  jest.clearAllMocks(); session = { end: jest.fn(), destroy: jest.fn(), write: jest.fn() }; mic = { stop: jest.fn() };
  mockInit.mockResolvedValue(undefined); mockOpen.mockResolvedValue(session); mockMic.mockReturnValue(mic); mockLoop.mockReturnValue(new Promise(() => {}));
  (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
});
it('does not open a session or microphone when cancelled during model initialization', async () => {
  const init = deferred(); mockInit.mockReturnValue(init.promise); const abort = new AbortController();
  const pending = startHandsFreeVoice(handlers, abort.signal); abort.abort(); init.resolve();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(mockOpen).not.toHaveBeenCalled(); expect(mockMic).not.toHaveBeenCalled();
});
it('destroys a late session without ever opening the microphone', async () => {
  const opened = deferred(), entered = deferred(); mockOpen.mockImplementation(() => { entered.resolve(); return opened.promise; });
  const abort = new AbortController(), pending = startHandsFreeVoice(handlers, abort.signal);
  await entered.promise; abort.abort(); opened.resolve(session);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(session.destroy).toHaveBeenCalledTimes(1); expect(mockMic).not.toHaveBeenCalled();
});
it('stops capture once, drops frames and ignores late state changes after abort', async () => {
  const abort = new AbortController(); const controller = await startHandsFreeVoice(handlers, abort.signal);
  const callback = mockMic.mock.calls[0][0], loop = mockLoop.mock.calls[0][1];
  callback(new Uint8Array([1])); expect(session.write).toHaveBeenCalledTimes(1);
  abort.abort(); controller.stop(); callback(new Uint8Array([2])); loop.onState('listening');
  expect(mic.stop).toHaveBeenCalledTimes(1); expect(session.destroy).toHaveBeenCalledTimes(1); expect(session.write).toHaveBeenCalledTimes(1); expect(handlers.onState).not.toHaveBeenCalled();
});
it('does not capture when permission is denied', async () => {
  (requestRecordingPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  await expect(startHandsFreeVoice(handlers)).rejects.toThrow('Microphone permission denied'); expect(mockMic).not.toHaveBeenCalled();
});
it('releases the native session if the microphone cannot start', async () => {
  mockMic.mockImplementationOnce(() => { throw new Error('no mic'); });
  await expect(startHandsFreeVoice(handlers)).rejects.toThrow('no mic'); expect(session.destroy).toHaveBeenCalledTimes(1);
});
