// services/QVACService.bootGuard.test.ts
//
// A native abort while the QVAC worklet boots kills the app before JS can
// catch anything. The service remembers an unfinished boot, so the next visit
// to the Mind tab shows the error banner instead of crashing again, until the
// user taps Retry.

jest.mock('@qvac/sdk', () => ({
  completion: jest.fn(),
  cancel: jest.fn(async () => undefined),
  loadModel: jest.fn(),
  transcribe: jest.fn(),
  transcribeStream: jest.fn(),
  textToSpeech: jest.fn(),
  unloadModel: jest.fn(),
  resume: jest.fn(async () => undefined),
  suspend: jest.fn(async () => undefined),
  embed: jest.fn(),
  VERBOSITY: { ERROR: 0 },
  TTS_EN_SUPERTONIC_Q4_0: {},
  EMBEDDINGGEMMA_300M_Q4_0: {},
  VAD_SILERO_5_1_2: {},
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { isEmulatorSync: () => false, getTotalMemory: async () => 8 * 1024 ** 3 },
}));
jest.mock('expo-file-system/legacy', () => ({ createDownloadResumable: jest.fn() }));
// The catalog's descriptors come from @qvac/sdk constants, which are mocked out here.
jest.mock('./qvacModels', () => {
  const actual = jest.requireActual('./qvacModels');
  const model = { id: 'test-llm', label: 'Test', localCapable: true, tier: 'phone', descriptor: { modelId: 'llm.gguf', expectedSize: 1 } };
  return { ...actual, getModelById: () => model, hfUrlFromDescriptor: () => 'https://example.invalid/llm.gguf' };
});

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStorage.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => { mockStorage.set(k, v); }),
    removeItem: jest.fn(async (k: string) => { mockStorage.delete(k); }),
  },
}));

const BOOT_KEY = 'qvac.workletBoot.v1';

type Loaded = {
  svc: any;
  sdk: { loadModel: jest.Mock; resume: jest.Mock };
  prefix: string;
};

/** A fresh module graph = a fresh app session (new singleton + session id). */
function newSession(): Loaded {
  let loaded!: Loaded;
  jest.isolateModules(() => {
    const mod = require('./QVACService');
    const svc = mod.default.getInstance();
    svc.setEnabled(true);
    jest.spyOn(svc, 'ensureLocalModel').mockResolvedValue('/models/llm.gguf');
    loaded = { svc, sdk: require('@qvac/sdk'), prefix: mod.WORKLET_CRASHED_PREFIX };
  });
  return loaded;
}

beforeEach(() => {
  mockStorage.clear();
});

describe('QVACService worklet boot guard', () => {
  it('marks the boot while the first model loads and clears it once loaded', async () => {
    const { svc, sdk } = newSession();
    let markerDuringLoad: string | undefined;
    sdk.loadModel.mockImplementation(async () => {
      markerDuringLoad = mockStorage.get(BOOT_KEY);
      return 'llm-1';
    });

    await svc.initializeLLM();

    expect(markerDuringLoad).toBeTruthy();
    expect(mockStorage.has(BOOT_KEY)).toBe(false);
    expect(svc.getState().llmStatus).toBe('ready');
  });

  it('a load that throws is an ordinary error, not a crash', async () => {
    const { svc, sdk } = newSession();
    sdk.loadModel.mockRejectedValue(new Error('out of memory'));

    await svc.initializeLLM();

    expect(svc.getState()).toMatchObject({ llmStatus: 'error', error: 'LLM: out of memory' });
    expect(mockStorage.has(BOOT_KEY)).toBe(false);
  });

  it('after a boot that never finished, shows the error instead of booting again', async () => {
    const crashed = newSession();
    crashed.sdk.loadModel.mockImplementation(() => new Promise(() => {})); // the process dies here
    void crashed.svc.initializeLLM();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockStorage.has(BOOT_KEY)).toBe(true);

    const next = newSession();
    next.sdk.loadModel.mockReset();
    await next.svc.initializeLLM();

    expect(next.sdk.loadModel).not.toHaveBeenCalled();
    expect(next.svc.ensureLocalModel).not.toHaveBeenCalled();
    const state = next.svc.getState();
    expect(state.llmStatus).toBe('error');
    expect(state.error.startsWith(next.prefix)).toBe(true);
  });

  it('Retry boots again after a crashed boot', async () => {
    mockStorage.set(BOOT_KEY, 'an-earlier-session');
    const { svc, sdk } = newSession();
    sdk.loadModel.mockResolvedValue('llm-1');

    await svc.initializeLLM();
    expect(sdk.loadModel).not.toHaveBeenCalled();

    await svc.initializeLLM({ retry: true });
    expect(sdk.loadModel).toHaveBeenCalled();
    expect(svc.getState().llmStatus).toBe('ready');
    expect(mockStorage.has(BOOT_KEY)).toBe(false);
  });

  it('voice models are also held back after a crashed boot', async () => {
    mockStorage.set(BOOT_KEY, 'an-earlier-session');
    const { svc, sdk } = newSession();

    await svc.initializeWhisper();

    expect(sdk.loadModel).not.toHaveBeenCalled();
    expect(svc.getState().whisperStatus).toBe('error');
  });

  it('foregrounding the app does not boot the worklet before a model loaded', async () => {
    const { svc, sdk } = newSession();

    await svc.resumeRuntime();
    expect(sdk.resume).not.toHaveBeenCalled();

    sdk.loadModel.mockResolvedValue('llm-1');
    await svc.initializeLLM();
    await svc.resumeRuntime();
    expect(sdk.resume).toHaveBeenCalled();
  });
});
