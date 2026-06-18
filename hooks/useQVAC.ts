// hooks/useQVAC.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import QVACService, { QVACState, QVACConfig } from '../services/QVACService';
import {
  QVAC_MODELS,
  QVAC_STT_MODELS,
  QVAC_TTS_OPTIONS,
  type QVACModel,
  type SttModel,
  type TtsOption,
  type TtsEngine,
} from '../services/qvacModels';

export interface UseQVACResult extends QVACState {
  service: QVACService;
  /** LLM is downloaded, loaded and ready to chat. */
  isReady: boolean;
  /** Whisper is downloaded, loaded and ready to transcribe. */
  isWhisperReady: boolean;
  /** Either model is currently downloading. */
  isDownloading: boolean;
  /** Either model is downloading or loading into memory. */
  isPreparing: boolean;
  /** 0-100 combined download progress used for the model-status UI. */
  combinedProgress: number;
  /** Manually (re)trigger model initialization, e.g. after an error. */
  initialize: () => void;
  /** Available chat models. */
  catalog: QVACModel[];
  /** Current config (selected model + delegation). */
  config: QVACConfig;
  /** Switch the active chat model (downloads/loads it). */
  setModel: (id: string) => Promise<void>;
  /** Configure P2P delegation to a remote provider. */
  setDelegate: (opts: { enabled: boolean; providerPublicKey: string }) => Promise<void>;
  /** Re-read the persisted config into React state (e.g. after pairing elsewhere). */
  reloadConfig: () => void;
  /** Total device RAM in GB (for the model picker), once detected. */
  deviceMemGb?: number;
  /** Model id recommended for this device's RAM. */
  recommendedModelId?: string;
  /** Available speech-to-text (Whisper) models for the voice mode. */
  sttCatalog: SttModel[];
  /** Available text-to-speech engines for the voice mode. */
  ttsOptions: TtsOption[];
  /** Switch the speech-to-text model. */
  setSttModel: (id: string) => Promise<void>;
  /** Switch the text-to-speech engine. */
  setTtsEngine: (engine: TtsEngine) => Promise<void>;
  /** Ids of models whose weights are fully downloaded on this device. */
  downloadedModelIds: string[];
  /** Delete a downloaded model's weights from disk. */
  deleteModel: (id: string) => Promise<void>;
}

/**
 * Subscribe to on-device QVAC model state and (optionally) kick off the
 * download + load of the LLM model on mount.
 *
 * Models are loaded lazily on first use of the AI assistant. We intentionally
 * do NOT unload on background — reloading a ~600MB model on every foreground is
 * far more jarring than the memory it holds. Call `service.unloadAll()` to free
 * memory explicitly if needed.
 */
export function useQVAC(autoInit: boolean = true): UseQVACResult {
  const service = useMemo(() => QVACService.getInstance(), []);
  const [state, setState] = useState<QVACState>(() => service.getState());
  const [config, setConfig] = useState<QVACConfig>(() => service.getConfig());

  useEffect(() => service.subscribe(setState), [service]);

  // Load persisted config once on mount
  useEffect(() => {
    let active = true;
    service.loadConfig().then((c) => { if (active) setConfig(c); });
    return () => { active = false; };
  }, [service]);

  // Which model weights are present on disk (for the delete UI). Refreshed
  // whenever a download completes or the settings sheet asks for it.
  const [downloadedModelIds, setDownloadedModelIds] = useState<string[]>(() =>
    service.getDownloadedModelIds()
  );
  const refreshDownloaded = useCallback(() => {
    setDownloadedModelIds(service.getDownloadedModelIds());
  }, [service]);

  const setModel = useCallback(async (id: string) => {
    await service.setModelId(id);
    setConfig(service.getConfig());
    refreshDownloaded();
  }, [service, refreshDownloaded]);

  const setSttModel = useCallback(async (id: string) => {
    await service.setSttModel(id);
    setConfig(service.getConfig());
    refreshDownloaded();
  }, [service, refreshDownloaded]);

  const setTtsEngine = useCallback(async (engine: TtsEngine) => {
    await service.setTtsEngine(engine);
    setConfig(service.getConfig());
  }, [service]);

  const deleteModel = useCallback(async (id: string) => {
    await service.deleteLocalModel(id);
    setConfig(service.getConfig());
    refreshDownloaded();
  }, [service, refreshDownloaded]);

  const setDelegate = useCallback(async (opts: { enabled: boolean; providerPublicKey: string }) => {
    await service.setDelegate(opts);
    setConfig(service.getConfig());
  }, [service]);

  // Pulls the singleton's current config into local state. Used when another
  // screen (e.g. PairDesktopScreen) changed delegation via the service directly.
  const reloadConfig = useCallback(() => {
    setConfig(service.getConfig());
  }, [service]);

  // Device RAM + the model recommended for it (for the picker UI).
  const [deviceMemGb, setDeviceMemGb] = useState<number | undefined>(undefined);
  const [recommendedModelId, setRecommendedModelId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    service.getDeviceMemoryBytes().then((b) => {
      if (active) setDeviceMemGb(Math.round((b / (1024 * 1024 * 1024)) * 10) / 10);
    });
    service.getRecommendedModelId().then((id) => {
      if (active) setRecommendedModelId(id);
    });
    return () => { active = false; };
  }, [service]);

  // Keep the local config in sync after the service mutates it itself — e.g.
  // an auto-fallback to a loadable model during initializeLLM(). Also refresh
  // the on-disk model list when a model becomes ready (download finished).
  useEffect(() => {
    setConfig(service.getConfig());
    setDownloadedModelIds(service.getDownloadedModelIds());
  }, [service, state.llmStatus, state.whisperStatus]);

  useEffect(() => {
    if (!autoInit || !config.delegateEnabled || !config.providerPublicKey) return;
    void service.checkProviderConnection();
    const timer = setInterval(() => {
      void service.checkProviderConnection();
    }, 15_000);
    return () => clearInterval(timer);
  }, [autoInit, config.delegateEnabled, config.providerPublicKey, service]);

  const initialize = useMemo(
    () => async () => {
      await service.initializeLLM();
    },
    [service]
  );

  useEffect(() => {
    if (autoInit) initialize();
  }, [autoInit, initialize]);

  // Suspend the QVAC runtime (Hyperswarm / Corestore networking) while the app
  // is backgrounded and resume it on return, per the SDK lifecycle API. Only
  // wire this up when AI is actually enabled: resume() boots the Bare worklet,
  // which aborts the process on an unsupported target (e.g. the Simulator). The
  // service methods are themselves guarded, but skipping the listener entirely
  // when disabled avoids ever calling into the SDK.
  useEffect(() => {
    if (!autoInit) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        void service.suspendRuntime();
      } else if (next === 'active') {
        void service.resumeRuntime();
      }
    });
    return () => sub.remove();
  }, [autoInit, service]);

  const isReady = state.llmStatus === 'ready';
  const isWhisperReady = state.whisperStatus === 'ready';
  const isDownloading =
    state.llmStatus === 'downloading' || state.whisperStatus === 'downloading';
  const isPreparing =
    isDownloading || state.llmStatus === 'loading' || state.whisperStatus === 'loading';

  const combinedProgress = state.llmStatus === 'ready' ? 100 : state.llmDownloadProgress;

  return {
    ...state,
    service,
    isReady,
    isWhisperReady,
    isDownloading,
    isPreparing,
    combinedProgress,
    initialize,
    catalog: QVAC_MODELS,
    config,
    setModel,
    setDelegate,
    reloadConfig,
    deviceMemGb,
    recommendedModelId,
    sttCatalog: QVAC_STT_MODELS,
    ttsOptions: QVAC_TTS_OPTIONS,
    setSttModel,
    setTtsEngine,
    downloadedModelIds,
    deleteModel,
  };
}

export default useQVAC;
