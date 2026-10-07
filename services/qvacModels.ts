// services/qvacModels.ts
//
// Curated catalog of on-device chat models exposed by the QVAC SDK, plus
// helpers to turn a model descriptor into a direct HTTPS download URL.
//
// Models run LOCALLY: we HTTPS-download the GGUF to the device and load it.
// Only possible for Hugging Face-hosted models (registryPath has /blob/ or
// /resolve/).
import {
  QWEN3_5_0_8B_MULTIMODAL_Q4_K_M,
  QWEN3_5_2B_MULTIMODAL_Q4_K_M,
  QWEN3_5_4B_MULTIMODAL_Q4_K_M,
} from '@qvac/sdk';

/** Minimum device class recommended to run a model LOCALLY (on-device). */
export type DeviceTier = 'phone' | 'pro' | 'mac';

export interface QVACModel {
  id: string;
  label: string;
  params: string;
  sizeMB: number;
  tier: DeviceTier;
  /** Raw SDK descriptor (registry path + expected size). */
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

// Qwen3.5 is the default family: same sizes as Qwen3, better at following
// instructions and calling the wallet tools. Its GGUFs run as text-only here
// (the "multimodal" descriptors only need an extra projector for images).
// A saved model that's no longer listed (Qwen3, Llama, GPT-OSS) is replaced by
// the one recommended for the device when the config loads (QVACService).
export const QVAC_MODELS: QVACModel[] = [
  entry(QWEN3_5_0_8B_MULTIMODAL_Q4_K_M, 'Qwen3.5 0.8B', 'phone'),
  entry(QWEN3_5_2B_MULTIMODAL_Q4_K_M, 'Qwen3.5 2B', 'phone'),
  entry(QWEN3_5_4B_MULTIMODAL_Q4_K_M, 'Qwen3.5 4B', 'pro'),
];

// Default chat model: Qwen3.5 2B (~1.3 GB) — fits modern iPhones and loads on
// Metal/GPU. recommendLocalModel still picks 0.8B on low-RAM devices.
export const DEFAULT_MODEL_ID =
  QVAC_MODELS.find((m) => m.descriptor === QWEN3_5_2B_MULTIMODAL_Q4_K_M)?.id ?? QVAC_MODELS[0].id;

export function getModelById(id: string | undefined | null): QVACModel {
  return QVAC_MODELS.find(m => m.id === id) ?? QVAC_MODELS[0];
}

const GiB = 1024 * 1024 * 1024;

/** Coarse device class from total RAM (phones only). */
export function classifyDeviceTier(totalMemBytes: number): DeviceTier {
  return 'phone';
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
  // 2B (~1.3 GB weights) loads comfortably on high-RAM phones (iPhone 15/16/17,
  // 6GB+); below that, stay on the small 0.8B so low-end devices never OOM.
  if (gb >= 6) pick = byDescriptor(QWEN3_5_2B_MULTIMODAL_Q4_K_M);  // high-RAM phone
  else pick = byDescriptor(QWEN3_5_0_8B_MULTIMODAL_Q4_K_M);         // small, safe default
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

// ---------------------------------------------------------------------------
// Speech-to-text (Whisper) catalog — used by the voice/vocal mode.
// All entries are HTTPS-downloadable from the pinned ggerganov/whisper.cpp repo.
// ---------------------------------------------------------------------------
const WHISPER_BASE_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';

export interface SttModel {
  id: string;
  label: string;
  /** Display hint: multilingual vs English-only. */
  lang: 'multi' | 'en';
  /** Absolute HTTPS download URL. */
  url: string;
  /** Local filename on disk. */
  name: string;
  /** Exact byte size (used for the reuse/integrity check). */
  size: number;
  sizeMB: number;
}

function stt(id: string, label: string, lang: 'multi' | 'en', file: string, size: number): SttModel {
  return {
    id,
    label,
    lang,
    url: `${WHISPER_BASE_URL}/${file}`,
    name: file,
    size,
    sizeMB: Math.round(size / 1048576),
  };
}

export const QVAC_STT_MODELS: SttModel[] = [
  stt('whisper-tiny', 'Whisper Tiny', 'multi', 'ggml-tiny.bin', 77691713),
  stt('whisper-tiny-en', 'Whisper Tiny (English)', 'en', 'ggml-tiny.en-q8_0.bin', 43550795),
  stt('whisper-base', 'Whisper Base', 'multi', 'ggml-base-q8_0.bin', 81768585),
  stt('whisper-base-en', 'Whisper Base (English)', 'en', 'ggml-base.en-q8_0.bin', 81781811),
  stt('whisper-large-v3-turbo', 'Whisper Large v3 Turbo', 'multi', 'ggml-large-v3-turbo.bin', 1624555275),
];

// Default voice model: Whisper Base — better accuracy than Tiny, still small
// enough to load quickly on-device.
export const DEFAULT_STT_MODEL_ID =
  QVAC_STT_MODELS.find((m) => m.id === 'whisper-base')?.id ?? QVAC_STT_MODELS[0].id;

export function getSttModelById(id: string | undefined | null): SttModel {
  return QVAC_STT_MODELS.find((m) => m.id === id) ?? QVAC_STT_MODELS[0];
}

// ---------------------------------------------------------------------------
// Text-to-speech engine options for the voice/vocal mode.
//  - 'supertonic': on-device neural SUPERTONIC-2 (natural, ~slower first load).
//  - 'system':     the OS speech synthesiser (instant, robotic, no download).
// ---------------------------------------------------------------------------
export type TtsEngine = 'supertonic' | 'system';

export interface TtsOption {
  id: TtsEngine;
  label: string;
  hint: string;
}

export const QVAC_TTS_OPTIONS: TtsOption[] = [
  { id: 'supertonic', label: 'Natural (on-device)', hint: 'Neural SUPERTONIC voice — best quality, downloads ~80 MB once.' },
  { id: 'system', label: 'System voice', hint: 'Instant, uses your phone’s built-in voice. No download.' },
];

export const DEFAULT_TTS_ENGINE: TtsEngine = 'supertonic';
