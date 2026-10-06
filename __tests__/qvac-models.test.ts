jest.mock('@qvac/sdk', () => {
  const d = (name: string, modelId: string, mb: number) => ({ name, modelId, expectedSize: mb * 1048576, params: '-',
    registryPath: `unsloth/x/resolve/rev/${modelId}` });
  return {
    QWEN3_5_0_8B_MULTIMODAL_Q4_K_M: d('QWEN3_5_0_8B_MULTIMODAL_Q4_K_M', 'Qwen3.5-0.8B-Q4_K_M.gguf', 508),
    QWEN3_5_2B_MULTIMODAL_Q4_K_M: d('QWEN3_5_2B_MULTIMODAL_Q4_K_M', 'Qwen3.5-2B-Q4_K_M.gguf', 1221),
    QWEN3_5_4B_MULTIMODAL_Q4_K_M: d('QWEN3_5_4B_MULTIMODAL_Q4_K_M', 'Qwen3.5-4B-Q4_K_M.gguf', 2614),
    QWEN3_600M_INST_Q4: d('QWEN3_600M_INST_Q4', 'Qwen3-0.6B-Q4_0.gguf', 364),
    QWEN3_1_7B_INST_Q4: d('QWEN3_1_7B_INST_Q4', 'Qwen3-1.7B-Q4_0.gguf', 1008),
  };
});
import { DEFAULT_MODEL_ID, QVAC_MODELS, getModelById, recommendLocalModel } from '../services/qvacModels';

const GB = 1024 ** 3;

test('Qwen3.5 is the default family, sized to the phone', () => {
  expect(QVAC_MODELS.map((m) => m.label)).toEqual(['Qwen3.5 0.8B', 'Qwen3.5 2B', 'Qwen3.5 4B', 'Qwen3 0.6B (previous)', 'Qwen3 1.7B (previous)']);
  expect(QVAC_MODELS.every((m) => m.localCapable && m.supportsTools)).toBe(true);
  expect(DEFAULT_MODEL_ID).toBe('QWEN3_5_2B_MULTIMODAL_Q4_K_M');
  expect(recommendLocalModel(8 * GB).id).toBe('QWEN3_5_2B_MULTIMODAL_Q4_K_M');
  expect(recommendLocalModel(4 * GB).id).toBe('QWEN3_5_0_8B_MULTIMODAL_Q4_K_M');
});

test('a model removed from the catalog falls back to one that exists', () => {
  expect(getModelById('GPT_OSS_20B_INST_Q4_K_M').id).toBe('QWEN3_5_0_8B_MULTIMODAL_Q4_K_M');
  expect(getModelById('QWEN3_1_7B_INST_Q4').label).toBe('Qwen3 1.7B (previous)'); // already downloaded: kept
});
