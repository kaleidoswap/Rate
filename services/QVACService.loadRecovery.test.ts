// services/QVACService.loadRecovery.test.ts
//
// "On-device AI failed to load" must be diagnosable and recoverable: a bad
// download (HTTP error body, truncated file) never reaches loadModel, a
// corrupt weights file is deleted so Retry downloads it again, the real reason
// survives a voice-model failure, and Retry really re-attempts.

jest.mock('@qvac/sdk', () => ({
  completion: jest.fn(),
  cancel: jest.fn(async () => undefined),
  loadModel: jest.fn(),
  transcribe: jest.fn(),
  transcribeStream: jest.fn(),
  textToSpeech: jest.fn(),
  unloadModel: jest.fn(async () => undefined),
  resume: jest.fn(async () => undefined),
  suspend: jest.fn(async () => undefined),
  embed: jest.fn(),
  VERBOSITY: { ERROR: 0 },
  TTS_MULTILINGUAL_SUPERTONIC3_Q8_0: {},
  EMBEDDINGGEMMA_300M_Q4_0: {},
  VAD_SILERO_5_1_2: {},
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { isEmulatorSync: () => false, getTotalMemory: async () => 8 * 1024 ** 3 },
}));

// In-memory disk: path -> size in bytes.
const mockDisk = new Map<string, number>();
jest.mock('expo-file-system', () => {
  const join = (parent: any, name: string) => `${parent.uri.replace(/\/$/, '')}/${name}`;
  class Directory {
    uri: string;
    constructor(parent: any, name: string) { this.uri = join(parent, name); }
    get exists() { return true; }
    create() {}
  }
  class File {
    uri: string;
    constructor(parent: any, name: string) { this.uri = join(parent, name); }
    get exists() { return mockDisk.has(this.uri); }
    info() { return { exists: this.exists, size: mockDisk.get(this.uri) ?? null }; }
    delete() { mockDisk.delete(this.uri); }
    move(dest: File) {
      mockDisk.set(dest.uri, mockDisk.get(this.uri)!);
      mockDisk.delete(this.uri);
      this.uri = dest.uri;
    }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///docs' }, availableDiskSpace: 64 * 1024 ** 3 } };
});

// Each download writes `mockNextDownload.size` bytes and answers `status`.
let mockNextDownload: { size: number; status: number } = { size: 0, status: 200 };
const mockDownloads: string[] = [];
jest.mock('expo-file-system/legacy', () => ({
  createDownloadResumable: jest.fn((url: string, fileUri: string) => ({
    downloadAsync: async () => {
      mockDownloads.push(url);
      mockDisk.set(fileUri, mockNextDownload.size);
      return { uri: fileUri, status: mockNextDownload.status, headers: {} };
    },
  })),
}));

const SIZE = 1000;
jest.mock('./qvacModels', () => {
  const actual = jest.requireActual('./qvacModels');
  const model = { id: 'test-llm', label: 'Test', localCapable: true, tier: 'phone', descriptor: { modelId: 'llm.gguf', expectedSize: 1000 } };
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

const MODEL_PATH = 'file:///docs/qvac-models/llm.gguf';
const PART_PATH = `${MODEL_PATH}.part`;

function newSession() {
  let svc: any;
  let sdk: any;
  let mod: any;
  let fs: any;
  jest.isolateModules(() => {
    mod = require('./QVACService');
    svc = mod.default.getInstance();
    svc.setEnabled(true);
    sdk = require('@qvac/sdk');
    fs = require('expo-file-system');
  });
  return { svc, sdk, mod, fs };
}

beforeEach(() => {
  mockDisk.clear();
  mockStorage.clear();
  mockDownloads.length = 0;
  mockNextDownload = { size: SIZE, status: 200 };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('model download', () => {
  it('an HTTP error body is not kept as the model', async () => {
    const { svc, sdk } = newSession();
    mockNextDownload = { size: 15, status: 429 };

    await svc.initializeLLM();

    expect(sdk.loadModel).not.toHaveBeenCalled();
    expect(svc.getState().llmStatus).toBe('error');
    expect(svc.getState().llmError).toContain('HTTP 429');
    expect(mockDisk.has(MODEL_PATH)).toBe(false);
    expect(mockDisk.has(PART_PATH)).toBe(false);
  });

  it('a truncated download is discarded and reported', async () => {
    const { svc, sdk } = newSession();
    mockNextDownload = { size: 400, status: 200 };

    await svc.initializeLLM();

    expect(sdk.loadModel).not.toHaveBeenCalled();
    expect(svc.getState().llmError).toContain('got 400 of 1000 bytes');
    expect(mockDisk.size).toBe(0);
  });

  it('a complete download is moved into place and loaded from a plain path', async () => {
    const { svc, sdk } = newSession();
    sdk.loadModel.mockResolvedValue('llm-1');

    await svc.initializeLLM();

    expect(svc.getState().llmStatus).toBe('ready');
    expect(mockDisk.get(MODEL_PATH)).toBe(SIZE);
    expect(mockDisk.has(PART_PATH)).toBe(false);
    expect(sdk.loadModel.mock.calls[0][0].modelSrc).toBe('/docs/qvac-models/llm.gguf');
  });

  it('a leftover partial file is replaced, not loaded', async () => {
    mockDisk.set(MODEL_PATH, 10);
    const { svc, sdk } = newSession();
    sdk.loadModel.mockResolvedValue('llm-1');

    await svc.initializeLLM();

    expect(mockDownloads).toHaveLength(1);
    expect(mockDisk.get(MODEL_PATH)).toBe(SIZE);
    expect(svc.getState().llmStatus).toBe('ready');
  });

  it('refuses to start a download that cannot fit on the disk', async () => {
    const { svc, fs } = newSession();
    const before = fs.Paths.availableDiskSpace;
    fs.Paths.availableDiskSpace = 500;
    try {
      await svc.initializeLLM();
    } finally {
      fs.Paths.availableDiskSpace = before;
    }
    expect(mockDownloads).toHaveLength(0);
    expect(svc.getState().llmError).toContain('Not enough free storage');
  });
});

describe('load failure and Retry', () => {
  it('a corrupt weights file is deleted, and Retry downloads it again and loads', async () => {
    mockDisk.set(MODEL_PATH, SIZE); // right size, bad bytes
    const { svc, sdk } = newSession();
    sdk.loadModel.mockRejectedValue(new Error("tensor 'blk.3' data is not within the file bounds, model is corrupted or incomplete"));

    await svc.initializeLLM();

    const state = svc.getState();
    expect(state.llmStatus).toBe('error');
    expect(state.llmError).toContain('model is corrupted or incomplete');
    expect(state.llmError).toContain('Retry downloads it again');
    expect(mockDisk.has(MODEL_PATH)).toBe(false);
    expect(mockDownloads).toHaveLength(0);

    sdk.loadModel.mockReset();
    sdk.loadModel.mockResolvedValue('llm-1');
    await svc.initializeLLM({ retry: true });

    expect(mockDownloads).toHaveLength(1);
    expect(svc.getState()).toMatchObject({ llmStatus: 'ready', llmError: null, error: null });
  });

  it('keeps a good download when the failure is not about the file', async () => {
    mockDisk.set(MODEL_PATH, SIZE);
    const { svc, sdk } = newSession();
    sdk.loadModel.mockRejectedValue(new Error('failed to allocate buffer: out of memory'));

    await svc.initializeLLM();

    expect(mockDisk.get(MODEL_PATH)).toBe(SIZE);
    expect(svc.getState().llmError).toBe('LLM: failed to allocate buffer: out of memory');
  });

  it('reports both the Metal and the CPU reasons when both loads fail', async () => {
    mockDisk.set(MODEL_PATH, SIZE);
    const { svc, sdk } = newSession();
    sdk.loadModel
      .mockRejectedValueOnce(new Error('ggml_metal_init: failed'))
      .mockRejectedValueOnce(new Error('llama_model_load: unknown model architecture'));

    await svc.initializeLLM();

    expect(svc.getState().llmError).toBe('LLM: llama_model_load: unknown model architecture (GPU: ggml_metal_init: failed)');
  });

  it('a speech-recognition failure neither replaces nor clears the chat-model error', async () => {
    mockDisk.set(MODEL_PATH, SIZE);
    const { svc, sdk } = newSession();
    sdk.loadModel.mockRejectedValue(new Error('out of memory'));
    await svc.initializeLLM();
    expect(svc.getState().error).toBe('LLM: out of memory');

    // Whisper's download starts (clearing its own error) then fails.
    mockNextDownload = { size: 1, status: 404 };
    await svc.initializeWhisper();

    const state = svc.getState();
    expect(state.whisperStatus).toBe('error');
    expect(state.whisperError).toContain('HTTP 404');
    expect(state.llmError).toBe('LLM: out of memory');
    expect(state.error).toBe('LLM: out of memory');
  });
});

describe('error helpers', () => {
  it('llmErrorDetail shows the underlying reason only', () => {
    const { mod } = newSession();
    expect(mod.llmErrorDetail('LLM: Download failed for x.gguf: HTTP 403')).toBe('Download failed for x.gguf: HTTP 403');
    expect(mod.llmErrorDetail(`${mod.WORKLET_CRASHED_PREFIX} closed`)).toBeNull();
    expect(mod.llmErrorDetail('unavailable: needs a device')).toBeNull();
    expect(mod.llmErrorDetail(null)).toBeNull();
  });

  it('isCorruptModelFileError separates file problems from memory/GPU ones', () => {
    const { mod } = newSession();
    expect(mod.isCorruptModelFileError('gguf_init_from_file: invalid magic characters')).toBe(true);
    expect(mod.isCorruptModelFileError('llama_model_load: error loading model: failed to read magic')).toBe(true);
    expect(mod.isCorruptModelFileError('out of memory')).toBe(false);
    expect(mod.isCorruptModelFileError('ggml_metal_init: failed to allocate')).toBe(false);
  });

  it('errorMessage includes the cause a QVAC error carries', () => {
    const { mod } = newSession();
    const err = new Error('Model load failed', { cause: new Error('mmap: No such file') } as any);
    expect(mod.errorMessage(err)).toBe('Model load failed (mmap: No such file)');
  });
});
