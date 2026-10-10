import React from 'react';
import { act, render } from '@testing-library/react-native';
import VoiceInput, { type VoiceInputRef } from './VoiceInput';
const mockPermission = jest.fn(), mockPrepare = jest.fn(), mockRecord = jest.fn(), mockRelease = jest.fn(), mockTranscribe = jest.fn();
jest.mock('expo-audio', () => ({
  AudioModule: { AudioRecorder: class { uri = 'clip.wav'; prepareToRecordAsync = mockPrepare; record = mockRecord; release = mockRelease; stop = jest.fn(); } },
  setAudioModeAsync: jest.fn(), requestRecordingPermissionsAsync: () => mockPermission(), IOSOutputFormat: { LINEARPCM: 'pcm' }, AudioQuality: { HIGH: 'high' },
}));
jest.mock('expo-file-system', () => ({ File: class { exists = true; delete() {} } }));
jest.mock('../services/QVACService', () => ({ __esModule: true, default: { getInstance: () => ({ getState: () => ({ whisperStatus: 'ready' }), transcribeAudio: mockTranscribe }) } }));
const deferred = () => { let resolve!: (v?: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
const callbacks = () => ({ onStart: jest.fn(), onEnd: jest.fn(), onResult: jest.fn(), onPartialResult: jest.fn(), onError: jest.fn() });
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); mockPermission.mockResolvedValue({ granted: true }); mockPrepare.mockResolvedValue(undefined); });
afterEach(() => jest.useRealTimers());
it('cancels a permission-pending start without activating the recorder', async () => {
  const permission = deferred(); mockPermission.mockReturnValue(permission.promise); const ref = React.createRef<VoiceInputRef>(), cb = callbacks();
  const view = render(<VoiceInput ref={ref} {...cb} />);
  await act(async () => { ref.current!.startListening(); ref.current!.cancelListening(); permission.resolve({ granted: true }); });
  expect(mockPrepare).not.toHaveBeenCalled(); expect(mockRecord).not.toHaveBeenCalled(); expect(cb.onStart).not.toHaveBeenCalled(); view.unmount();
});
it('does not start a recorder that finished preparing after the screen closed', async () => {
  const prepare = deferred(); mockPrepare.mockReturnValue(prepare.promise); const ref = React.createRef<VoiceInputRef>(), cb = callbacks();
  const view = render(<VoiceInput ref={ref} {...cb} />);
  await act(async () => { ref.current!.startListening(); });
  expect(mockPrepare).toHaveBeenCalled(); view.unmount();
  await act(async () => { prepare.resolve(); await Promise.resolve(); jest.advanceTimersByTime(300); });
  expect(mockRecord).not.toHaveBeenCalled(); expect(mockRelease).toHaveBeenCalled(); expect(cb.onStart).not.toHaveBeenCalled();
});
it('discards a transcription that completes after Pause', async () => {
  const transcription = deferred(); mockTranscribe.mockReturnValue(transcription.promise); const ref = React.createRef<VoiceInputRef>(), cb = callbacks();
  const view = render(<VoiceInput ref={ref} {...cb} />);
  await act(async () => { ref.current!.startListening(); });
  await act(async () => { jest.advanceTimersByTime(300); });
  await act(async () => { ref.current!.stopListening(); });
  expect(mockTranscribe).toHaveBeenCalled();
  await act(async () => { ref.current!.cancelListening(); transcription.resolve('pay now'); });
  expect(cb.onResult).not.toHaveBeenCalled(); view.unmount();
});
