import { diagnosticError, recordVoiceDiagnostic, voiceDiagnosticReport, waitForVoice } from './voiceDiagnostics';
jest.mock('react-native-device-info', () => ({ __esModule: true, default: { getVersion: () => 'test', getBuildNumber: () => '1', getModel: () => 'test phone' } }));
afterEach(() => jest.useRealTimers());
it('cancels the exact native request on timeout and reports the stage', async () => {
  jest.useFakeTimers(); const cancel = jest.fn().mockResolvedValue(undefined);
  const promise = waitForVoice(new Promise(() => {}), 'tts-42', undefined, 90, 'generating', cancel);
  const rejected = expect(promise).rejects.toThrow('generating timed out');
  jest.advanceTimersByTime(90); await rejected;
  expect(cancel).toHaveBeenCalledWith('tts-42');
});
it('cancels while loading and does not leave a timeout running', async () => {
  jest.useFakeTimers(); const controller = new AbortController(); const cancel = jest.fn().mockResolvedValue(undefined);
  const promise = waitForVoice(new Promise(() => {}), 'load-1', controller.signal, 90, 'loading', cancel);
  const rejected = expect(promise).rejects.toThrow('cancelled'); controller.abort(); await rejected;
  jest.advanceTimersByTime(100); expect(cancel).toHaveBeenCalledTimes(1);
});
it('successful synthesis clears timeout and abort listener', async () => {
  jest.useFakeTimers(); const cancel = jest.fn(); const controller = new AbortController();
  expect(await waitForVoice(Promise.resolve([1]), 'r', controller.signal, 90, 'generating', cancel)).toEqual([1]);
  controller.abort(); jest.advanceTimersByTime(100); expect(cancel).not.toHaveBeenCalled();
});
it('exports bounded metadata and removes spoken text and URLs from errors', () => {
  const safe = diagnosticError('Failed Ciao Walter https://example.com/token', ['Ciao Walter']);
  expect(safe).not.toContain('Walter'); expect(safe).not.toContain('example.com');
  for (let i = 0; i < 160; i++) recordVoiceDiagnostic('test', safe);
  const report = JSON.parse(voiceDiagnosticReport());
  expect(report.events).toHaveLength(150); expect(report.build).toBe('1');
});
