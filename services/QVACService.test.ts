// services/QVACService.test.ts
//
// The agent's completion path: QVACService.runProviderTurn → @kaleidorg/mind's
// QVAC provider → @qvac/sdk completion(). Guards that tool parameters reach the
// model (QVAC treats a tool without `type: 'function'` as a Zod input and drops
// its arguments) and that a stopped run resolves instead of throwing.

import { completion } from '@qvac/sdk';
import QVACService from './QVACService';
import { buildWalletToolSource } from './walletTools';

jest.mock('@qvac/sdk', () => ({
  completion: jest.fn(),
  cancel: jest.fn(async () => undefined),
  loadModel: jest.fn(),
  transcribe: jest.fn(),
  transcribeStream: jest.fn(),
  textToSpeech: jest.fn(),
  unloadModel: jest.fn(),
  resume: jest.fn(),
  suspend: jest.fn(),
  embed: jest.fn(),
  VERBOSITY: { ERROR: 0 },
  TTS_MULTILINGUAL_SUPERTONIC3_Q8_0: { modelName: 'supertonic3-q8_0' },
  EMBEDDINGGEMMA_300M_Q4_0: {},
  VAD_SILERO_5_1_2: {},
}));
jest.mock('react-native-device-info', () => ({ __esModule: true, default: {} }));
jest.mock('expo-file-system/legacy', () => ({ createDownloadResumable: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock('./protocols', () => ({ protocolManager: { getAdapterIfAvailable: jest.fn() } }));
jest.mock('../store/storeProvider', () => ({ getStore: jest.fn() }));
jest.mock('../store/slices/walletSlice', () => ({ fetchBitcoinPrice: jest.fn() }));
jest.mock('./NostrService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('../utils/lnurl', () => ({ resolveLightningAddressToInvoice: jest.fn() }));

const mockedCompletion = completion as unknown as jest.Mock;

function run(final: Promise<unknown>) {
  return {
    requestId: 'req-1',
    events: (async function* () {
      yield { type: 'contentDelta', text: 'Partial' };
    })(),
    final,
  };
}

function service(): QVACService {
  const svc = QVACService.getInstance();
  (svc as any).llmModelId = 'model-1';
  return svc;
}

describe('QVACService.runProviderTurn', () => {
  beforeEach(() => mockedCompletion.mockReset());

  it('passes wallet tool parameters to completion()', async () => {
    mockedCompletion.mockReturnValue(
      run(Promise.resolve({ contentText: 'ok', toolCalls: [], stats: { promptTokens: 10, generatedTokens: 5 } })),
    );
    const tools = buildWalletToolSource().listTools();

    const out = await service().runProviderTurn({ messages: [{ role: 'user', content: 'hi' }], tools } as any);

    const sent = mockedCompletion.mock.calls[0][0].tools as any[];
    expect(sent).toHaveLength(tools.length);
    for (const t of sent) expect(t.type).toBe('function');

    const rgbInvoice = sent.find((t) => t.name === 'rln_create_rgb_invoice');
    expect(rgbInvoice.parameters).toEqual({
      type: 'object',
      properties: {
        asset: { type: 'string', description: 'RGB asset ticker or id.' },
        amount: { type: 'number', description: 'Asset amount to receive.' },
      },
      required: ['asset', 'amount'],
    });
    expect(Object.keys(sent.find((t) => t.name === 'send_payment').parameters.properties)).toEqual([
      'to',
      'amount_sats',
    ]);
    expect(out.inference?.totalTokens).toBe(15);
  });

  it('resolves a cancelled run as a cancelled turn', async () => {
    class InferenceCancelledError extends Error {
      requestId = 'req-1';
      partial = { text: 'Partial', toolCalls: [] };
    }
    mockedCompletion.mockReturnValue(run(Promise.reject(new InferenceCancelledError('cancelled'))));

    const out = await service().runProviderTurn({ messages: [{ role: 'user', content: 'hi' }], tools: [] } as any);

    expect(out.text).toBe('Partial');
    expect(out.inference?.status).toBe('cancelled');
  });
});

describe('Supertonic 3 mobile integration', () => {
  afterEach(() => jest.restoreAllMocks());
  it('loads the multilingual model once, preserves Italian and keeps the listening session alive', async () => {
    const svc = service() as any;
    svc.ttsModelId = null; svc.ttsLoadPromise = null; svc.whisperModelId = 'active-whisper';
    jest.spyOn(svc, 'workletBlocked').mockReturnValue(false);
    jest.spyOn(svc, 'bootLoad').mockImplementation((load: any) => load());
    const unloadWhisper = jest.spyOn(svc, 'unloadWhisper');
    const sdk = require('@qvac/sdk');
    sdk.loadModel.mockResolvedValue('supertonic3');
    sdk.textToSpeech.mockReturnValue({ buffer: Promise.resolve([1, 2]), sampleRate: Promise.resolve(24000) });
    expect(await svc.synthesizeSpeech('Il pagamento è pronto.')).toEqual({ pcm: [1, 2], sampleRate: 24000 });
    await svc.synthesizeSpeech('Grazie!');
    expect(sdk.loadModel).toHaveBeenCalledTimes(1);
    expect(sdk.loadModel).toHaveBeenCalledWith(expect.objectContaining({
      modelSrc: sdk.TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
      modelConfig: expect.objectContaining({ language: 'it', voice: 'F1', ttsNumInferenceSteps: 8 }),
    }));
    expect(sdk.textToSpeech).toHaveBeenCalledWith(expect.objectContaining({ text: 'Il pagamento è pronto.' }));
    // Validate the actual app config against the installed SDK, not a mocked loadModel.
    const { execFileSync } = require('node:child_process');
    const { pathToFileURL } = require('node:url');
    const { dirname, join } = require('node:path');
    const schemaUrl = pathToFileURL(join(dirname(require.resolve('@qvac/inference/package')), 'dist/schemas/text-to-speech.js')).href;
    const validation = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { readFileSync } from 'node:fs';
      const { ttsSupertonicLoadConfigSchema: schema } = await import(${JSON.stringify(schemaUrl)});
      schema.parse(JSON.parse(readFileSync(0, 'utf8')));
      process.stdout.write('valid');
    `], { input: JSON.stringify(sdk.loadModel.mock.calls[0][0].modelConfig), encoding: 'utf8' });
    expect(validation).toBe('valid');

    expect(unloadWhisper).not.toHaveBeenCalled();
    expect(svc.whisperModelId).toBe('active-whisper');
    sdk.unloadModel.mockResolvedValue(undefined);
    await svc.synthesizeSpeech('Hello, your payment was received.');
    expect(sdk.unloadModel).toHaveBeenCalledWith({ modelId: 'supertonic3', clearStorage: false });
    expect(sdk.loadModel).toHaveBeenLastCalledWith(expect.objectContaining({ modelConfig: expect.objectContaining({ language: 'en' }) }));
  });
});
