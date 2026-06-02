// hooks/useQVAC.ts
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { resume, suspend } from '@qvac/sdk';
import QVACService, { QVACState, QVACConfig } from '../services/QVACService';
import { QVAC_MODELS, type QVACModel } from '../services/qvacModels';

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

  const setModel = useCallback(async (id: string) => {
    await service.setModelId(id);
    setConfig(service.getConfig());
  }, [service]);

  const setDelegate = useCallback(async (opts: { enabled: boolean; providerPublicKey: string }) => {
    await service.setDelegate(opts);
    setConfig(service.getConfig());
  }, [service]);

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
  // is backgrounded and resume it on return, per the SDK lifecycle API. Both
  // are safe to call from any state, so we just guard with try/catch.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        void suspend().catch(() => {});
      } else if (next === 'active') {
        void resume().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

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
  };
}

export default useQVAC;
