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

const GiB = 1024 * 1024 * 1024;

/** Coarse device class from total RAM (phones only — Macs run via delegation). */
export function classifyDeviceTier(totalMemBytes: number): DeviceTier {
  return totalMemBytes >= 5.5 * GiB ? 'pro' : 'phone';
}

/**
 * Pick the model to run LOCALLY on a device with `totalMemBytes` of RAM.
 * Deliberately conservative — favour the smallest model that still gives decent
 * tool-calling, so a phone stays responsive and never OOMs loading the weights.
 * Only ever returns a `localCapable` model (HTTPS-downloadable).
 */
export function recommendLocalModel(totalMemBytes: number): QVACModel {
  const byDescriptor = (d: any) => QVAC_MODELS.find(m => m.descriptor === d);
  const gb = totalMemBytes / GiB;
  let pick: QVACModel | undefined;
  if (gb < 3) pick = byDescriptor(QWEN3_600M_INST_Q4);              // tiny, low-end
  else if (gb < 5.5) pick = byDescriptor(LLAMA_TOOL_CALLING_1B_INST_Q4_K); // small + good tools
  else pick = byDescriptor(QWEN3_1_7B_INST_Q4);                      // roomy phone
  // Fall back to any local-capable model (then the first model) if a descriptor
  // is missing or somehow not downloadable.
  return (
    (pick && pick.localCapable ? pick : undefined) ??
    QVAC_MODELS.find(m => m.localCapable) ??
    QVAC_MODELS[0]
  );
}

export function recommendLocalModelId(totalMemBytes: number): string {
  return recommendLocalModel(totalMemBytes).id;
}
