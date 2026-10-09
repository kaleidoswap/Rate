import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockService = {
  getState: () => ({ llmStatus: 'error', whisperStatus: 'not_downloaded', llmDownloadProgress: 0, whisperDownloadProgress: 0, error: 'crashed: boot' }),
  getConfig: () => ({ modelId: 'm', sttModelId: 's', ttsEngine: 'system' }),
  subscribe: () => () => {},
  loadConfig: jest.fn(async () => ({ modelId: 'm', sttModelId: 's', ttsEngine: 'system' })),
  getDownloadedModelIds: () => [],
  getDeviceMemoryBytes: jest.fn(async () => 4 * 1024 ** 3),
  getRecommendedModelId: jest.fn(async () => 'm'),
  initializeLLM: jest.fn(async () => undefined),
  suspendRuntime: jest.fn(),
  resumeRuntime: jest.fn(),
};
jest.mock('../services/QVACService', () => ({
  __esModule: true,
  default: { getInstance: () => mockService },
}));
jest.mock('../services/qvacModels', () => ({ QVAC_MODELS: [], QVAC_STT_MODELS: [], QVAC_TTS_OPTIONS: [] }));

import { useQVAC } from './useQVAC';

const originalAppState = (require('react-native') as any).AppState;
beforeEach(() => {
  mockService.initializeLLM.mockClear();
  (require('react-native') as any).AppState = { addEventListener: () => ({ remove: () => {} }) };
});
afterEach(() => { (require('react-native') as any).AppState = originalAppState; });

test('the automatic start respects a crashed boot; Retry asks to boot again', async () => {
  const hook = renderHook(() => useQVAC(true));
  await waitFor(() => expect(mockService.initializeLLM).toHaveBeenCalledTimes(1));
  expect(mockService.initializeLLM).toHaveBeenLastCalledWith();

  await act(async () => { await hook.result.current.initialize(); });
  expect(mockService.initializeLLM).toHaveBeenLastCalledWith({ retry: true });
  hook.unmount();
});

test('a failing start does not surface as an unhandled rejection', async () => {
  mockService.initializeLLM.mockRejectedValueOnce(new Error('boom'));
  const hook = renderHook(() => useQVAC(true));
  await waitFor(() => expect(mockService.initializeLLM).toHaveBeenCalled());
  hook.unmount();
});
