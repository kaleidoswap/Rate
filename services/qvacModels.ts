// services/qvacModels.ts
//
// Curated catalog of on-device chat models exposed by the QVAC SDK, plus
// helpers to turn a model descriptor into a direct HTTPS download URL.
//
// Two ways a model can run:
//  - LOCAL: we HTTPS-download the GGUF to the device and load it. Only possible
//    for Hugging Face-hosted models (registryPath has /blob/ or /resolve/).
//  - DELEGATED: inference runs on a remote P2P provider (e.g. a Mac), so the
//    phone never downloads the weights. Any model works delegated.
import {
  QWEN3_600M_INST_Q4,
  LLAMA_3_2_1B_INST_Q4_0,
  LLAMA_TOOL_CALLING_1B_INST_Q4_K,
  QWEN3_1_7B_INST_Q4,
  QWEN3_4B_INST_Q4_K_M,
  QWEN3_8B_INST_Q4_K_M,
  GPT_OSS_20B_INST_Q4_K_M,
} from '@qvac/sdk';

/** Minimum device class recommended to run a model LOCALLY (on-device). */
export type DeviceTier = 'phone' | 'pro' | 'mac';

export interface QVACModel {
  id: string;
  label: string;
  params: string;
  sizeMB: number;
  tier: DeviceTier;
  /** Raw SDK descriptor — passed to loadModel in delegated mode. */
  descriptor: any;
  modelType: 'llamacpp-completion';
  /** True if we can HTTPS-download it for local on-device use. */
  localCapable: boolean;
  /** Good at structured tool/function calling (used by the wallet assistant). */
  supportsTools: boolean;
}

/**
 * Build a direct Hugging Face download URL from a descriptor's registryPath,
 * e.g. "owner/repo/blob/<rev>/file.gguf" -> ".../resolve/<rev>/file.gguf".
 * Returns null for non-HF (QVAC-registry-only) models.
 */
export function hfUrlFromDescriptor(descriptor: any): string | null {
  const path: string = String(descriptor?.registryPath || '');
  if (!/\/(blob|resolve)\//.test(path)) return null;
  return `https://huggingface.co/${path.replace('/blob/', '/resolve/')}`;
}

function entry(
  descriptor: any,
  label: string,
  tier: DeviceTier,
  supportsTools = true
): QVACModel {
  const sizeMB = descriptor?.expectedSize ? Math.round(descriptor.expectedSize / 1048576) : 0;
  return {
    id: descriptor?.name ?? label,
    label,
    params: descriptor?.params ?? '-',
    sizeMB,
    tier,
    descriptor,
    modelType: 'llamacpp-completion',
    localCapable: hfUrlFromDescriptor(descriptor) !== null,
    supportsTools,
  };
}

export const QVAC_MODELS: QVACModel[] = [
  entry(QWEN3_600M_INST_Q4, 'Qwen3 0.6B', 'phone'),
  entry(LLAMA_3_2_1B_INST_Q4_0, 'Llama 3.2 1B', 'phone'),
  entry(LLAMA_TOOL_CALLING_1B_INST_Q4_K, 'Llama 1B (tool-calling)', 'phone'),
  entry(QWEN3_1_7B_INST_Q4, 'Qwen3 1.7B', 'pro'),
  entry(QWEN3_4B_INST_Q4_K_M, 'Qwen3 4B', 'mac'),
  entry(QWEN3_8B_INST_Q4_K_M, 'Qwen3 8B', 'mac'),
  entry(GPT_OSS_20B_INST_Q4_K_M, 'GPT-OSS 20B', 'mac'),
];

export const DEFAULT_MODEL_ID = QVAC_MODELS[0].id;

export function getModelById(id: string | undefined | null): QVACModel {
  return QVAC_MODELS.find(m => m.id === id) ?? QVAC_MODELS[0];
}
