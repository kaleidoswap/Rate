// services/QVACService.ts
import {
  loadModel,
  completion,
  transcribe,
  transcribeStream,
  textToSpeech,
  unloadModel,
  cancel,
  resume,
  suspend,
  heartbeat,
  VERBOSITY,
  embed,
  TTS_EN_SUPERTONIC_Q4_0,
  WHISPER_BASE_Q8_0,
  EMBEDDINGGEMMA_300M_Q4_0,
} from '@qvac/sdk';
import { NativeModules, Platform } from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { createDownloadResumable } from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import DeviceInfo from 'react-native-device-info';
import {
  QVAC_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
  hfUrlFromDescriptor,
  recommendLocalModel,
  recommendLocalModelId,
  QVAC_STT_MODELS,
  DEFAULT_STT_MODEL_ID,
  getSttModelById,
  DEFAULT_TTS_ENGINE,
  type QVACModel,
  type TtsEngine,
} from './qvacModels';
import type { TurnInput, TurnOutput } from '@kaleidorg/mind';
import {
  createQvacProvider,
  createQvacVoice,
  buildDelegateConfig,
  cleanAssistantVisibleText,
  sanitizeForSupertonic,
} from '@kaleidorg/mind/qvac';
import { isLikelyValueMovingToolName } from '../utils/toolSafety';

// CPU baseline config for the local llamacpp model. Used as the GPU fallback
// and as the base the GPU attempt overrides (device + gpu_layers).
const LOCAL_LLM_CONFIG = {
  device: 'cpu',
  gpu_layers: 0,
  ctx_size: 2048,
  tools: true,
  verbosity: VERBOSITY.ERROR,
} as const;

// GPU (Metal on iPhone) offload config tried first for local inference — far
// faster than CPU when llamacpp can init the Metal context in the worklet. We
// fall back to LOCAL_LLM_CONFIG (CPU) automatically if the GPU load throws.
// ctx 4096 gives the agentic prompt (system + tools + skills + a little history)
// room to fit on-device; 2048 overflowed immediately ("prompt exceeds context").
const LOCAL_LLM_CONFIG_GPU = {
  ...LOCAL_LLM_CONFIG,
  device: 'gpu',
  gpu_layers: 99, // offload all layers; llamacpp clamps to the model's count
  ctx_size: 4096,
} as const;

// Delegated to a desktop provider — it has the RAM to run a big context, so give
// the agentic prompt plenty of room (Qwen3-600M supports up to 32k). 2048
// overflowed with the system prompt + tool/skill definitions alone.
const DELEGATE_LLM_CONFIG = {
  ...LOCAL_LLM_CONFIG_GPU,
  ctx_size: 16384,
} as const;

/**
 * On a phone we download model weights over plain HTTPS with React Native's
 * own networking (expo-file-system) instead of QVAC's `downloadAsset`, whose
 * `registry://` source pulls over a Hyperswarm/DHT P2P transport that crashes
 * the bare worklet on iOS. Once the file is on disk we hand the local path to
 * `loadModel`, which mmaps it directly (no worklet networking involved).
 *
 * In DELEGATED mode the model is loaded/run on a remote P2P provider (e.g. a
 * Mac), so the phone never downloads the weights — we pass the SDK descriptor
 * plus a `delegate` config to `loadModel`.
 */
// SUPERTONIC-2 TTS output sample rate (Hz). Used to build the WAV for playback.
const TTS_SAMPLE_RATE = 44100;

// Whisper languages we'll request directly from the device locale. whisper.cpp
// supports far more, but the QVAC handler rejects "auto"/detect_language for
// these tiny models, so we pass a concrete code (and fall back to 'en').
const WHISPER_LANGS = new Set([
  'en', 'it', 'es', 'fr', 'de', 'pt', 'nl', 'ru', 'pl', 'uk', 'tr', 'ar',
  'zh', 'ja', 'ko', 'hi', 'id', 'sv', 'no', 'da', 'fi', 'cs', 'ro', 'el',
  'he', 'th', 'vi', 'hu', 'ca',
]);

/**
 * Best-effort 2-letter language code from the OS locale (e.g. "it-IT" → "it"),
 * restricted to codes Whisper handles well. Falls back to 'en'.
 */
function deviceWhisperLanguage(): string {
  try {
    let loc = 'en';
    if (Platform.OS === 'ios') {
      const s: any = NativeModules.SettingsManager?.settings;
      loc = s?.AppleLocale || (Array.isArray(s?.AppleLanguages) ? s.AppleLanguages[0] : '') || 'en';
    } else {
      loc = NativeModules.I18nManager?.localeIdentifier || 'en';
    }
    const code = String(loc).split(/[-_]/)[0].toLowerCase();
    return WHISPER_LANGS.has(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

function isPhoneRuntime(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

// `sanitizeForSupertonic` + `cleanAssistantVisibleText` now live in
// @kaleidorg/mind/qvac (imported above) — one implementation, shared with desktop.

const CONFIG_KEY = 'qvac.config.v1';

export interface QVACConfig {
  /** Selected chat model id (see qvacModels.ts). */
  modelId: string;
  /** Route inference to a remote P2P provider instead of running on-device. */
  delegateEnabled: boolean;
  /** Public key of the QVAC provider to delegate to (from `startQVACProvider`). */
  providerPublicKey: string;
  /** Selected speech-to-text (Whisper) model id for the voice mode. */
  sttModelId: string;
  /** Text-to-speech engine for the voice mode ('supertonic' | 'system'). */
  ttsEngine: TtsEngine;
  /** True once the user explicitly chose a TTS engine in settings. */
  ttsEngineUserSelected?: boolean;
}

const DEFAULT_CONFIG: QVACConfig = {
  modelId: DEFAULT_MODEL_ID,
  delegateEnabled: false,
  providerPublicKey: '',
  sttModelId: DEFAULT_STT_MODEL_ID,
  ttsEngine: DEFAULT_TTS_ENGINE,
};

export type ModelStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';

export interface QVACState {
  llmStatus: ModelStatus;
  whisperStatus: ModelStatus;
  llmDownloadProgress: number;
  whisperDownloadProgress: number;
  error: string | null;
  /** Measured throughput for the latest completion. */
  tokensPerSecond: number | null;
  /** Where the active LLM is actually running. */
  inferenceDevice: 'metal' | 'cpu' | 'desktop' | null;
  /** Reachability of the configured desktop provider. */
  providerReachable: boolean | null;
}

export interface QVACTool {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  /**
   * When true the tool is NOT auto-executed by `chat()`. Instead it is returned
   * with `pending: true` so the UI can ask the user to confirm (e.g. payments)
   * before invoking the handler explicitly.
   */
  requiresConfirmation?: boolean;
}

export interface QVACToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  /** True when the tool needs user confirmation before its handler runs. */
  pending?: boolean;
}

type StateListener = (state: QVACState) => void;

class QVACService {
  private static instance: QVACService;

  private llmModelId: string | null = null;
  private whisperModelId: string | null = null;
  private ttsModelId: string | null = null;
  private embedModelId: string | null = null;
  private embedLoadPromise: Promise<string> | null = null;
  private ttsLoadPromise: Promise<string> | null = null;

  private config: QVACConfig = { ...DEFAULT_CONFIG };
  private configLoaded = false;
  private deviceMemBytes: number | null = null;

  private state: QVACState = {
    llmStatus: 'not_downloaded',
    whisperStatus: 'not_downloaded',
    llmDownloadProgress: 0,
    whisperDownloadProgress: 0,
    error: null,
    tokensPerSecond: null,
    inferenceDevice: null,
    providerReachable: null,
  };

  private listeners = new Set<StateListener>();

  // Master kill switch for on-device AI. Defaults OFF: starting the QVAC Bare
  // worklet on a native/JS mismatch (or on the iOS Simulator, which has no
  // bare-abort framework) aborts the process natively — an error JS can't catch.
  // App.tsx syncs this from the persisted KaleidoMind mode (settings.aiMode), so the
  // worklet can never start until the user explicitly opts in.
  private enabled = false;

  // All completion + tool-call parsing lives in @kaleidorg/mind-qvac (shared with
  // desktop). We inject the raw SDK fns + a model-id resolver; this host keeps
  // model lifecycle (load/unload, GPU/delegate) below. Defaults mirror the prior
  // inline turn (0.6 temperature, 512-token cap), overridable per turn.
  private readonly mindProvider = createQvacProvider({
    completion,
    cancel,
    getModelId: () => this.llmModelId,
    defaultTemperature: 0.6,
    defaultMaxTokens: 512,
  });

  // Shared voice orchestration (transcribe + synth, and the VAD session for
  // hands-free mode). The SDK fns are injected; this host owns model lifecycle
  // (load/unload below) via the model-id resolvers.
  private readonly mindVoice = createQvacVoice({
    transcribe,
    textToSpeech,
    transcribeStream,
    getWhisperModelId: () => this.whisperModelId,
    getTtsModelId: () => this.ttsModelId,
  });

  private constructor() {}

  static getInstance(): QVACService {
    if (!QVACService.instance) {
      QVACService.instance = new QVACService();
    }
    return QVACService.instance;
  }

  /** Enable/disable on-device AI. When disabled, all model init is a no-op. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // BUILD-LEVEL KILL SWITCH for the QVAC Bare worklet.
  //
  // The worklet bundle imports the `bare-abort` native addon at startup, but
  // that framework is NOT linked into the app binary in the current build — on
  // BOTH the iOS Simulator AND a physical device it aborts with:
  //   AddonError: ADDON_NOT_FOUND … bare-abort.2.0.13.framework
  // That aborts the whole process (an unhandled rejection in a separate runtime
  // that JS can't catch), so on-device AI is completely non-functional until the
  // native packaging is fixed (embed bare-abort.*.framework via react-native-
  // bare-kit). Until then we must NEVER boot the worklet.
  //
  // Enabled now that the Bare addon xcframeworks (bare-abort + the full set in
  // qvac/addons.manifest.json) are linked into the iOS app via the bare-kit
  // pod's prepare_command (`node ios/link.mjs`). Requires a fresh native build
  // (`npx expo run:ios --device`) so the frameworks are embedded. If the worklet
  // ever aborts with ADDON_NOT_FOUND again, the addons weren't linked — re-run
  // the link step + pod install (see scripts/link-bare-addons.sh).
  private static readonly NATIVE_RUNTIME_AVAILABLE = true;

  // Cached, SYNCHRONOUS "can the Bare worklet even run here?" check — decided
  // WITHOUT booting the worklet (booting an unsupported build aborts the process).
  private _runtimeOk: boolean | null = null;
  private runtimeOkSync(): boolean {
    if (!QVACService.NATIVE_RUNTIME_AVAILABLE) return false;
    if (this._runtimeOk == null) {
      try {
        this._runtimeOk = !DeviceInfo.isEmulatorSync();
      } catch {
        this._runtimeOk = true; // unknown → assume a real device build
      }
    }
    return this._runtimeOk;
  }

  /**
   * The single gate every worklet-touching method checks. Returns true when it
   * is NOT safe to touch the QVAC runtime (disabled, or unsupported target).
   */
  private workletBlocked(): boolean {
    return !this.enabled || !this.runtimeOkSync();
  }

  /** Resume QVAC runtime networking — guarded so it never boots the worklet here. */
  async resumeRuntime(): Promise<void> {
    if (this.workletBlocked()) return;
    try {
      await resume();
    } catch {
      /* non-fatal */
    }
  }

  /** Suspend QVAC runtime networking — guarded so it never boots the worklet here. */
  async suspendRuntime(): Promise<void> {
    if (this.workletBlocked()) return;
    try {
      await suspend();
    } catch {
      /* non-fatal */
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): QVACState {
    return { ...this.state };
  }

  private setState(partial: Partial<QVACState>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }

  // --- Config (selected model + P2P delegation) ---

  /** Available chat models (the catalog). */
  getCatalog(): QVACModel[] {
    return QVAC_MODELS;
  }

  getConfig(): QVACConfig {
    return { ...this.config };
  }

  /** Total device RAM in bytes (cached). Falls back to a modest 3 GB estimate. */
  async getDeviceMemoryBytes(): Promise<number> {
    if (this.deviceMemBytes != null) return this.deviceMemBytes;
    try {
      const mem = await DeviceInfo.getTotalMemory();
      this.deviceMemBytes = mem && mem > 0 ? mem : 3 * 1024 * 1024 * 1024;
    } catch {
      this.deviceMemBytes = 3 * 1024 * 1024 * 1024;
    }
    return this.deviceMemBytes;
  }

  /** The model recommended for this device's RAM (for the picker UI). */
  async getRecommendedModelId(): Promise<string> {
    return recommendLocalModelId(await this.getDeviceMemoryBytes());
  }

  /**
   * Whether the QVAC Bare worklet can run here AT ALL — checked WITHOUT booting
   * it (booting on an unsupported target aborts the process natively, which JS
   * can't catch). The iOS Simulator has no bare-abort framework, so the worklet
   * can't start there; both on-device and delegate modes need it. Used by the
   * KaleidoMind onboarding to steer users and to refuse init instead of crashing.
   */
  async getAvailability(): Promise<{
    runtimeAvailable: boolean;
    localCapable: boolean;
    deviceMemGb: number;
  }> {
    const runtimeAvailable = this.runtimeOkSync();
    const mem = await this.getDeviceMemoryBytes();
    // Any real phone runs the smallest model; below ~3 GB we recommend delegating.
    const localCapable = runtimeAvailable && mem >= 3 * 1024 * 1024 * 1024;
    return {
      runtimeAvailable,
      localCapable,
      deviceMemGb: Math.round((mem / (1024 * 1024 * 1024)) * 10) / 10,
    };
  }

  async loadConfig(): Promise<QVACConfig> {
    if (this.configLoaded) return this.getConfig();
    let hadSaved = false;
    try {
      const raw = await AsyncStorage.getItem(CONFIG_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.config = { ...DEFAULT_CONFIG, ...saved };
        if (saved.ttsEngine === 'system' && !saved.ttsEngineUserSelected) {
          this.config.ttsEngine = DEFAULT_TTS_ENGINE;
        }
        hadSaved = true;
      }
    } catch {
      /* use defaults */
    }
    // First run (no saved choice): pick a model that fits this device's RAM
    // instead of always defaulting to the same one.
    if (!hadSaved) {
      try {
        this.config = { ...this.config, modelId: await this.getRecommendedModelId() };
      } catch {
        /* keep DEFAULT_MODEL_ID */
      }
    }
    this.configLoaded = true;
    return this.getConfig();
  }

  private async saveConfig() {
    try {
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch {
      /* ignore persistence errors */
    }
  }

  /** Switch the active chat model and reload it. */
  async setModelId(id: string): Promise<void> {
    if (id === this.config.modelId) return;
    this.config = { ...this.config, modelId: id };
    await this.saveConfig();
    await this.reloadLLM();
  }

  /** Configure P2P delegation (run inference on a remote provider) and reload. */
  async setDelegate(opts: { enabled: boolean; providerPublicKey: string }): Promise<void> {
    this.config = {
      ...this.config,
      delegateEnabled: opts.enabled,
      providerPublicKey: opts.providerPublicKey.trim(),
    };
    this.setState({ providerReachable: null });
    await this.saveConfig();
    await this.reloadLLM();
  }

  async checkProviderConnection(): Promise<boolean> {
    await this.loadConfig();
    if (!this.config.delegateEnabled || !this.config.providerPublicKey || this.workletBlocked()) {
      this.setState({ providerReachable: null });
      return false;
    }
    try {
      await heartbeat({
        delegate: {
          providerPublicKey: this.config.providerPublicKey,
          timeout: 4000,
          healthCheckTimeout: 4000,
        },
      });
      this.setState({ providerReachable: true });
      return true;
    } catch {
      this.setState({ providerReachable: false });
      return false;
    }
  }

  /**
   * Align delegation with the chosen KaleidoMind mode: Desktop => delegate,
   * Local/Off => on-device. This is the bridge between the redux `aiMode` and
   * the engine config, so picking "Desktop" actually runs inference remotely
   * (previously the mode and config.delegateEnabled were never synced, so
   * "Desktop" still ran the model locally). No-ops when nothing changes, and
   * won't enable delegation until a desktop is paired.
   */
  async setDelegateEnabled(enabled: boolean): Promise<void> {
    await this.loadConfig();
    if (enabled === this.config.delegateEnabled) return;
    if (enabled && !this.config.providerPublicKey) return; // wait for pairing
    await this.setDelegate({ enabled, providerPublicKey: this.config.providerPublicKey });
  }

  /**
   * Unload + re-initialize the LLM (after a model/delegation change).
   *
   * Only HOT-reloads when the LLM was already running. From a cold state we must
   * NOT boot it here: this is reached at app startup via the aiMode→delegate sync
   * (App.tsx QVACEnabledSync → setDelegateEnabled → setDelegate), and cold-booting
   * the worklet + loading the model at launch means a model-load/worklet crash
   * bricks the entire app in a restart loop. Cold, we just reset status and let
   * the model load lazily when the user opens the AI screen (AIAssistantScreen's
   * useQVAC autoInit on focus). Mirrors the "reload only if already active"
   * guard in setSttModel.
   */
  private async reloadLLM(): Promise<void> {
    const wasActive =
      !!this.llmModelId ||
      this.state.llmStatus === 'ready' ||
      this.state.llmStatus === 'loading' ||
      this.state.llmStatus === 'downloading';
    await this.unloadLLM().catch(() => {});
    this.setState({ llmStatus: 'not_downloaded', llmDownloadProgress: 0, error: null });
    if (wasActive) await this.initializeLLM();
  }

  /** Switch the speech-to-text (Whisper) model and reload it if it was active. */
  async setSttModel(id: string): Promise<void> {
    await this.loadConfig();
    if (id === this.config.sttModelId) return;
    this.config = { ...this.config, sttModelId: id };
    await this.saveConfig();
    // Only reload Whisper if it was already loaded/loading — otherwise it'll
    // pick up the new model lazily on next voice use.
    if (this.whisperModelId || this.state.whisperStatus !== 'not_downloaded') {
      await this.unloadWhisper().catch(() => {});
      this.setState({ whisperStatus: 'not_downloaded', whisperDownloadProgress: 0 });
      if (!this.workletBlocked()) await this.initializeWhisper();
    }
  }

  /** Switch the text-to-speech engine (natural SUPERTONIC vs system voice). */
  async setTtsEngine(engine: TtsEngine): Promise<void> {
    await this.loadConfig();
    if (engine === this.config.ttsEngine) return;
    this.config = { ...this.config, ttsEngine: engine, ttsEngineUserSelected: true };
    await this.saveConfig();
    // Free the neural TTS weights when switching to the system voice.
    if (engine === 'system') await this.unloadTts().catch(() => {});
  }

  /** Engine currently selected for speech output. */
  getTtsEngine(): TtsEngine {
    return this.config.ttsEngine ?? DEFAULT_TTS_ENGINE;
  }

  // --- Local model file management (download / delete) ---

  /** Map a downloadable model id to its on-disk filename, if any. */
  private localFileNameForId(id: string): string | null {
    const chat = QVAC_MODELS.find((m) => m.id === id);
    if (chat?.descriptor?.modelId) return String(chat.descriptor.modelId);
    const stt = QVAC_STT_MODELS.find((m) => m.id === id);
    if (stt) return stt.name;
    return null;
  }

  /**
   * Ids of models whose weights are fully downloaded on this device (chat + STT).
   * A file counts as present only if its size matches the expected size, so a
   * half-finished download isn't reported as installed.
   */
  getDownloadedModelIds(): string[] {
    const dir = new Directory(Paths.document, 'qvac-models');
    const present: string[] = [];
    const check = (id: string, name: string, expected: number) => {
      try {
        const f = new File(dir, name);
        if (f.exists && (f.info().size ?? 0) === expected) present.push(id);
      } catch { /* ignore */ }
    };
    for (const m of QVAC_MODELS) {
      if (m.localCapable && m.descriptor?.modelId) {
        check(m.id, String(m.descriptor.modelId), m.descriptor.expectedSize ?? -1);
      }
    }
    for (const s of QVAC_STT_MODELS) check(s.id, s.name, s.size);
    return present;
  }

  /**
   * Delete a downloaded model's weights from disk. If it's the model currently
   * loaded, it is unloaded first so the file isn't held open.
   */
  async deleteLocalModel(id: string): Promise<void> {
    const name = this.localFileNameForId(id);
    if (!name) return;
    // Unload if it's the active chat or STT model.
    const chat = QVAC_MODELS.find((m) => m.id === id);
    if (chat && this.config.modelId === id) await this.unloadLLM().catch(() => {});
    const stt = QVAC_STT_MODELS.find((m) => m.id === id);
    if (stt && this.config.sttModelId === id) await this.unloadWhisper().catch(() => {});
    try {
      const file = new File(new Directory(Paths.document, 'qvac-models'), name);
      if (file.exists) file.delete();
    } catch { /* ignore */ }
  }

  /**
   * Download a model over HTTPS (if not already on disk) and return an
   * absolute filesystem path suitable for `loadModel({ modelSrc })`.
   */
  private async ensureLocalModel(
    model: { url: string; name: string; size: number },
    onProgress: (pct: number) => void
  ): Promise<string> {
    const dir = new Directory(Paths.document, 'qvac-models');
    try {
      if (!dir.exists) dir.create({ intermediates: true } as any);
    } catch {
      // directory may already exist
    }

    const file = new File(dir, model.name);

    // Reuse a previously-downloaded, complete file
    if (file.exists) {
      let size = 0;
      try { size = file.info().size ?? 0; } catch { /* ignore */ }
      if (size === model.size) {
        onProgress(100);
        return file.uri.replace('file://', '');
      }
      try { file.delete(); } catch { /* ignore */ }
    }

    // Download to a *known* path with a real byte-progress callback. The new
    // `File.downloadFileAsync` derives its own filename and exposes no progress,
    // so the legacy resumable API is used purely for its progress callback.
    console.log(`[QVAC] downloading ${model.name} via https…`);
    onProgress(0);
    let lastPct = -1;
    const resumable = createDownloadResumable(
      model.url,
      file.uri,
      {},
      (p) => {
        const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : model.size;
        const pct = total > 0 ? Math.min(99, Math.round((p.totalBytesWritten / total) * 100)) : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          onProgress(pct);
        }
      }
    );

    const result = await resumable.downloadAsync();
    if (!result?.uri) throw new Error(`Download failed for ${model.name}`);
    onProgress(100);
    console.log(`[QVAC] downloaded ${model.name}`);
    return result.uri.replace('file://', '');
  }

  // --- LLM lifecycle ---

  // Whether to try GPU offload for local inference before CPU. Metal on iOS;
  // not attempted on Android (Vulkan path in llamacpp is not stable on all
  // devices — CPU inference is reliable and fast enough on arm64).
  private static PREFER_GPU = Platform.OS === 'ios';

  /**
   * Load the local llamacpp model with Metal/GPU offload when possible, falling
   * back to CPU if the GPU context can't initialise in the Bare worklet. The
   * GPU path is dramatically faster on iPhone (A-series Metal) for the small
   * models we run on-device.
   */
  private async loadLocalLLM(modelSrc: any): Promise<string> {
    if (QVACService.PREFER_GPU) {
      try {
        const id = await loadModel({
          modelSrc,
          modelType: 'llamacpp-completion',
          modelConfig: { ...LOCAL_LLM_CONFIG_GPU },
        } as any);
        console.log('[QVAC] LLM loaded with Metal/GPU offload');
        this.setState({ inferenceDevice: 'metal' });
        return id;
      } catch (gpuErr) {
        // Metal failed to init the llamacpp context — don't try it again this
        // session, and fall through to CPU.
        QVACService.PREFER_GPU = false;
        console.warn(
          '[QVAC] Metal/GPU load failed, falling back to CPU:',
          gpuErr instanceof Error ? gpuErr.message : String(gpuErr)
        );
      }
    }
    const id = await loadModel({
      modelSrc,
      modelType: 'llamacpp-completion',
      modelConfig: { ...LOCAL_LLM_CONFIG },
    } as any);
    console.log('[QVAC] LLM loaded on CPU');
    this.setState({ inferenceDevice: 'cpu' });
    return id;
  }

  async initializeLLM(): Promise<void> {
    // Hard gate: never start the Bare worklet unless AI is enabled AND the
    // runtime can actually run here. On an unsupported target (e.g. the iOS
    // Simulator) booting the worklet aborts the process, so we refuse and
    // surface a clear, actionable error instead.
    if (!this.enabled) {
      console.log('[QVAC] LLM init skipped — on-device AI is disabled');
      return;
    }
    if (!this.runtimeOkSync()) {
      console.warn('[QVAC] LLM init skipped — worklet runtime unavailable on this device');
      this.setState({
        llmStatus: 'error',
        error: 'unavailable: KaleidoMind needs a physical device. Connect a desktop to delegate.',
      });
      return;
    }
    if (this.state.llmStatus === 'ready' || this.state.llmStatus === 'downloading' || this.state.llmStatus === 'loading') {
      return;
    }

    try {
      await this.loadConfig();
      let model = getModelById(this.config.modelId);
      const delegating = this.config.delegateEnabled && !!this.config.providerPublicKey;

      // Guard: if we're running on-device but the selected model can't be
      // downloaded here (P2P-only, e.g. Qwen3 4B, or oversized for this phone),
      // fall back to a hardware-appropriate local model instead of failing to
      // load. This is the common cause of "on-device AI failed to load" after a
      // bigger model was selected during desktop/delegated testing.
      if (!delegating && (!model.localCapable || model.tier !== 'phone')) {
        const fallback = recommendLocalModel(await this.getDeviceMemoryBytes());
        console.warn(
          `[QVAC] '${model.label}' isn't enabled for stable on-device iPhone loading; falling back to '${fallback.label}'`
        );
        model = fallback;
        this.config = { ...this.config, modelId: fallback.id };
        await this.saveConfig();
      }

      let modelSrc: any;
      if (delegating) {
        // Weights are resolved/loaded on the remote provider — pass the SDK
        // descriptor; the phone downloads nothing.
        this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });
        modelSrc = model.descriptor;
        console.log('[QVAC] LLM: delegating', model.id, '→', this.config.providerPublicKey.slice(0, 12) + '…');
      } else {
        this.setState({ llmStatus: 'downloading', llmDownloadProgress: 0, error: null });
        const url = hfUrlFromDescriptor(model.descriptor)!;
        modelSrc = await this.ensureLocalModel(
          { url, name: model.descriptor.modelId, size: model.descriptor.expectedSize },
          (pct) => this.setState({ llmDownloadProgress: pct })
        );
        console.log('[QVAC] LLM: loadModel start', modelSrc);
        this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });
      }

      try {
        if (delegating) {
          // Delegated: the provider (e.g. a Mac) runs the model on its GPU.
          this.llmModelId = await loadModel({
            modelSrc,
            modelType: 'llamacpp-completion',
            modelConfig: { ...DELEGATE_LLM_CONFIG },
            delegate: buildDelegateConfig(this.config.providerPublicKey),
          } as any);
          this.setState({ inferenceDevice: 'desktop' });
          this.setState({ providerReachable: true });
        } else {
          // Local: try Metal/GPU offload first, fall back to CPU.
          this.llmModelId = await this.loadLocalLLM(modelSrc);
        }
      } catch (loadErr) {
        if (!delegating) throw loadErr;
        // Delegation failed (provider unreachable / RPC error, e.g. a stale
        // "GPT_OSS_20B + delegate" config left over from desktop testing).
        // Un-stick the phone: disable delegation, persist it, and load a local
        // hardware-appropriate model instead of staying stuck on the provider.
        console.warn(
          '[QVAC] delegation failed; falling back to a local model:',
          loadErr instanceof Error ? loadErr.message : String(loadErr)
        );
        const local = recommendLocalModel(await this.getDeviceMemoryBytes());
        this.config = { ...this.config, modelId: local.id, delegateEnabled: false };
        this.setState({ providerReachable: false });
        await this.saveConfig();
        this.setState({ llmStatus: 'downloading', llmDownloadProgress: 0, error: null });
        const localUrl = hfUrlFromDescriptor(local.descriptor)!;
        const localSrc = await this.ensureLocalModel(
          { url: localUrl, name: local.descriptor.modelId, size: local.descriptor.expectedSize },
          (pct) => this.setState({ llmDownloadProgress: pct })
        );
        this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });
        this.llmModelId = await this.loadLocalLLM(localSrc);
      }

      this.setState({ llmStatus: 'ready' });
      console.log('QVAC LLM ready:', this.llmModelId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('QVAC LLM init failed:', msg);
      this.setState({ llmStatus: 'error', error: `LLM: ${msg}` });
    }
  }

  // --- Whisper lifecycle ---

  async initializeWhisper(): Promise<void> {
    // Hard gate: Whisper also runs in the Bare worklet — never start it unless
    // on-device AI is enabled and the runtime can actually run here.
    if (this.workletBlocked()) {
      console.warn('[QVAC] Whisper init skipped — disabled or runtime unavailable');
      return;
    }
    if (this.state.whisperStatus === 'ready' || this.state.whisperStatus === 'downloading' || this.state.whisperStatus === 'loading') {
      return;
    }

    try {
      await this.loadConfig();

      // Delegated: transcription runs on the remote provider's Whisper model
      // (the same desktop provider the LLM delegates to). The phone downloads no
      // weights — we pass an SDK descriptor + `delegate`, and the bound modelId
      // then makes every transcribeAudio() call route over P2P. If the provider
      // is unreachable we fall through to the local download/load path below.
      const delegating = this.config.delegateEnabled && !!this.config.providerPublicKey;
      if (delegating) {
        this.setState({ whisperStatus: 'loading', whisperDownloadProgress: 100, error: null });
        try {
          this.whisperModelId = await loadModel({
            modelSrc: WHISPER_BASE_Q8_0,
            modelType: 'whispercpp-transcription',
            modelConfig: { language: deviceWhisperLanguage(), strategy: 'greedy', audio_format: 's16le' } as any,
            delegate: buildDelegateConfig(this.config.providerPublicKey),
          } as any);
          this.setState({ whisperStatus: 'ready' });
          console.log('[QVAC] Whisper ready (delegated):', this.whisperModelId);
          return;
        } catch (delErr) {
          console.warn(
            '[QVAC] Whisper delegation failed; falling back to local model:',
            delErr instanceof Error ? delErr.message : String(delErr)
          );
        }
      }

      this.setState({ whisperStatus: 'downloading', whisperDownloadProgress: 0, error: null });

      // Use the user-selected Whisper variant, but keep the phone voice loop
      // memory-safe. whisper-large-v3-turbo is ~1.6 GB; loading neural TTS right
      // after it on iOS can get the app jetsammed before JS can catch anything.
      const selectedStt = getSttModelById(this.config.sttModelId);
      const stt = isPhoneRuntime() && selectedStt.id === 'whisper-large-v3-turbo'
        ? getSttModelById(DEFAULT_STT_MODEL_ID)
        : selectedStt;
      if (stt.id !== selectedStt.id) {
        console.warn(`[QVAC] Whisper model '${selectedStt.id}' is too large for phone voice mode; using '${stt.id}'`);
      }
      const modelPath = await this.ensureLocalModel(
        { url: stt.url, name: stt.name, size: stt.size },
        (pct) => this.setState({ whisperDownloadProgress: pct })
      );

      // English-only variants are pinned to 'en'; multilingual variants use the
      // device locale (e.g. Italian) so non-English speech transcribes instead
      // of being force-decoded as English → empty. The QVAC whisper handler
      // rejects "auto"/detect_language for these tiny models, so we always pass
      // a concrete code and fall back to 'en' if the chosen one won't load.
      const primaryLang = stt.lang === 'en' ? 'en' : deviceWhisperLanguage();
      const loadWhisper = (language: string) =>
        loadModel({
          modelSrc: modelPath,
          modelType: 'whispercpp-transcription',
          modelConfig: { language, strategy: 'greedy', audio_format: 's16le' } as any,
        });

      console.log('[QVAC] Whisper: loadModel start', stt.id, 'lang=' + primaryLang, modelPath);
      this.setState({ whisperStatus: 'loading', whisperDownloadProgress: 100 });

      try {
        this.whisperModelId = await loadWhisper(primaryLang);
      } catch (langErr) {
        if (primaryLang === 'en') throw langErr;
        console.warn(`[QVAC] Whisper load failed for '${primaryLang}', retrying as 'en':`,
          langErr instanceof Error ? langErr.message : String(langErr));
        this.whisperModelId = await loadWhisper('en');
      }

      this.setState({ whisperStatus: 'ready' });
      console.log('QVAC Whisper ready:', this.whisperModelId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('QVAC Whisper init failed:', msg);
      this.setState({ whisperStatus: 'error', error: `Whisper: ${msg}` });
    }
  }

  // --- Chat completion with tool calling ---

  async chat(params: {
    messages: Array<{ role: string; content: string }>;
    tools?: QVACTool[];
    /** Called for every visible content token as it streams in. */
    onToken?: (token: string) => void;
    /**
     * Called synchronously with the run's requestId the moment generation
     * starts, so the UI can cancel it mid-stream via `cancelRequest()`.
     */
    onStart?: (requestId: string) => void;
  }): Promise<{ text: string; toolCalls: QVACToolCall[]; requestId: string }> {
    if (!this.llmModelId) {
      throw new Error('LLM model not loaded');
    }

    const tools = params.tools ?? [];
    const toolsByName = new Map(tools.map(t => [t.name, t]));
    const toolDefs = tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      handler: t.handler,
    }));

    // Canonical completion API (QVAC v0.12): a typed `events` stream plus an
    // aggregated `final` promise. `requestId` is available synchronously.
    const run = completion({
      modelId: this.llmModelId,
      history: params.messages,
      stream: true,
      tools: toolDefs.length ? toolDefs : undefined,
    });

    params.onStart?.(run.requestId);

    // Stream visible content tokens. `contentDelta` excludes <think> reasoning
    // (use `thinkingDelta` if you ever want to surface the model's reasoning).
    let streamed = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        streamed += event.text;
        params.onToken?.(event.text);
      }
    }

    const final = await run.final;
    const text = cleanAssistantVisibleText(final.contentText || streamed);

    // Resolve tool calls. Financial tools (requiresConfirmation) are returned
    // as `pending` instead of being auto-invoked, so the UI can confirm first.
    const executedCalls: QVACToolCall[] = [];

    for (const call of final.toolCalls) {
      const def = toolsByName.get(call.name);

      if (def?.requiresConfirmation) {
        executedCalls.push({
          name: call.name,
          arguments: call.arguments,
          pending: true,
        });
        continue;
      }

      let callResult: unknown;
      if (call.invoke) {
        try {
          callResult = await call.invoke();
        } catch (err) {
          callResult = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      executedCalls.push({
        name: call.name,
        arguments: call.arguments,
        result: callResult,
      });
    }

    return { text, toolCalls: executedCalls, requestId: run.requestId };
  }

  /**
   * One completion turn in the shape the shared @kaleido/mind Engine expects.
   * The Engine owns the agentic loop + tool execution; this just runs a single
   * round and returns the assistant text, the raw frame (for history push-back)
   * and any tool calls the model requested. Tools are passed as schemas only —
   * the Engine executes them via its ToolSources (so wallet signing stays here
   * on-device even when inference is delegated).
   */
  async runProviderTurn(
    input: TurnInput & { onThinking?: (token: string) => void; temperature?: number; maxTokens?: number },
  ): Promise<TurnOutput> {
    // The shared provider runs completion + streams tokens (contentDelta →
    // onToken, thinkingDelta → onThinking) + parses the final frame. It reads the
    // model id via the `getModelId` closure above, so this stays a thin binding.
    const startedAt = Date.now();
    const output = await this.mindProvider.runTurn(input);
    const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    const generatedText = output.rawContent || output.text || '';
    const estimatedTokens = Math.max(
      1,
      Math.round(generatedText.length / 4),
    );
    this.setState({
      tokensPerSecond: Number((estimatedTokens / elapsedSeconds).toFixed(1)),
    });
    return output;
  }

  /** Cancel an in-flight completion by its requestId (for a stop button). */
  async cancelRequest(requestId: string): Promise<void> {
    await this.mindProvider.cancel?.(requestId);
  }

  // --- Transcription ---

  async transcribeAudio(audioUri: string): Promise<string> {
    if (this.workletBlocked()) throw new Error('Whisper model not loaded');
    // The file:// strip + transcribe call live in the shared voice helper (it
    // also throws if the Whisper model id isn't resolved yet).
    return this.mindVoice.transcribeAudio(audioUri);
  }

  /**
   * Open a hands-free VAD transcription session for continuous voice. The caller
   * feeds raw PCM via `session.write()` and drives it with `runVoiceAssistant`
   * (both from @kaleidorg/mind/qvac). Requires the Whisper model loaded and
   * @qvac/sdk ≥ 0.13.1 (the VAD conversation session). The one-shot
   * `transcribeAudio` path above still works on 0.12.x.
   */
  async openVoiceSession() {
    if (this.workletBlocked()) throw new Error('on-device AI unavailable on this device');
    return this.mindVoice.openVoiceSession();
  }

  // --- Text-to-speech (on-device, QVAC SUPERTONIC-2) ---

  /** True once the TTS model is resident. */
  isTtsReady(): boolean {
    return this.ttsModelId != null;
  }

  /**
   * Load the QVAC 0.12 GGML Supertonic TTS model and keep it resident.
   * Idempotent + single-flighted so concurrent speak calls share one load.
   */
  private async ensureTtsLoaded(): Promise<string> {
    if (this.ttsModelId) return this.ttsModelId;
    if (this.ttsLoadPromise) return this.ttsLoadPromise;

    this.ttsLoadPromise = (async () => {
      const delegating = this.config.delegateEnabled && !!this.config.providerPublicKey;
      console.log(`[QVAC] TTS: loading Supertonic GGML model${delegating ? ' (delegated)' : ''}`);
      // On-device only: free the Whisper weights before loading the neural voice
      // so the phone never holds both in RAM. When delegating, both models live
      // on the remote provider, so there's nothing local to unload.
      if (!delegating && this.whisperModelId) {
        console.log('[QVAC] TTS: unloading Whisper before neural voice load');
        await this.unloadWhisper().catch(() => {});
      }
      const id = await loadModel({
        modelSrc: TTS_EN_SUPERTONIC_Q4_0,
        modelType: 'tts-ggml',
        modelConfig: {
          ttsEngine: 'supertonic',
          language: 'en',
          voice: 'F1',
          ttsSpeed: 1.05,
          ttsNumInferenceSteps: 5,
        },
        ...(delegating
          ? { delegate: buildDelegateConfig(this.config.providerPublicKey) }
          : {}),
      } as any);
      this.ttsModelId = id;
      console.log('[QVAC] TTS ready:', id);
      return id;
    })();

    try {
      return await this.ttsLoadPromise;
    } catch (e) {
      this.ttsLoadPromise = null; // allow a retry
      throw e;
    }
  }

  /**
   * Synthesize speech for `text` on-device. Returns 16-bit PCM samples + the
   * sample rate, or null when on-device AI is unavailable (caller falls back to
   * the system voice). Throws on a genuine synthesis error.
   */
  async synthesizeSpeech(text: string): Promise<{ pcm: number[]; sampleRate: number } | null> {
    if (this.workletBlocked()) return null;
    // Early-out before loading the TTS model: the shared helper sanitizes +
    // refuses unspeakable input internally, but we check here too so we never
    // spin up the neural voice for empty/redacted text.
    if (!sanitizeForSupertonic(text)) return null;
    await this.ensureTtsLoaded();
    // sanitize + U+0060 refusal + textToSpeech → 16-bit PCM live in the helper
    // (44.1 kHz SUPERTONIC default).
    return this.mindVoice.synthesizeSpeech(text);
  }

  // --- Embeddings (for on-device RAG) ---

  /** Lazily load the embeddings model (EmbeddingGemma-300M) on first use. */
  private async ensureEmbedModel(): Promise<string> {
    if (this.embedModelId) return this.embedModelId;
    if (!this.embedLoadPromise) {
      this.embedLoadPromise = (async () => {
        const id: string = await loadModel({
          modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
          modelType: 'embeddings',
          verbosity: VERBOSITY.ERROR,
        } as any);
        this.embedModelId = id;
        return id;
      })();
    }
    return this.embedLoadPromise;
  }

  /** Embed texts on-device (the QVAC half of RAG). One vector per input text. */
  async embed(texts: string[]): Promise<number[][]> {
    const modelId = await this.ensureEmbedModel();
    const out: number[][] = [];
    for (const text of texts) {
      const res: any = await embed({ modelId, text });
      out.push(res.embedding as number[]);
    }
    return out;
  }

  // --- Cleanup ---

  async unloadEmbeddings(): Promise<void> {
    if (this.embedModelId) {
      try {
        await unloadModel({ modelId: this.embedModelId, clearStorage: false });
      } catch {
        /* ignore */
      }
      this.embedModelId = null;
      this.embedLoadPromise = null;
    }
  }

  async unloadTts(): Promise<void> {
    if (this.ttsModelId) {
      try {
        await unloadModel({ modelId: this.ttsModelId, clearStorage: false });
      } catch {
        /* ignore */
      }
      this.ttsModelId = null;
      this.ttsLoadPromise = null;
    }
  }

  async unloadLLM(): Promise<void> {
    if (this.llmModelId) {
      await unloadModel({ modelId: this.llmModelId, clearStorage: false });
      this.llmModelId = null;
      this.setState({
        llmStatus: 'not_downloaded',
        tokensPerSecond: null,
        inferenceDevice: null,
        providerReachable: null,
      });
    }
  }

  async unloadWhisper(): Promise<void> {
    if (this.whisperModelId) {
      await unloadModel({ modelId: this.whisperModelId, clearStorage: false });
      this.whisperModelId = null;
      this.setState({ whisperStatus: 'not_downloaded' });
    }
  }

  async unloadAll(): Promise<void> {
    await Promise.all([this.unloadLLM(), this.unloadWhisper(), this.unloadTts(), this.unloadEmbeddings()]);
  }
}

export default QVACService;
