// hooks/useQVAC.ts
import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { resume, suspend } from '@qvac/sdk';
import QVACService, { QVACState } from '../services/QVACService';

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
}

/**
 * Subscribe to on-device QVAC model state and (optionally) kick off the
 * download + load of the LLM and Whisper models on mount.
 *
 * Models are loaded lazily on first use of the AI assistant. We intentionally
 * do NOT unload on background — reloading a ~600MB model on every foreground is
 * far more jarring than the memory it holds. Call `service.unloadAll()` to free
 * memory explicitly if needed.
 */
export function useQVAC(autoInit: boolean = true): UseQVACResult {
  const service = useMemo(() => QVACService.getInstance(), []);
  const [state, setState] = useState<QVACState>(() => service.getState());

  useEffect(() => service.subscribe(setState), [service]);

  const initialize = useMemo(
    () => async () => {
      // Load sequentially — kicking off two concurrent loadModel calls into a
      // freshly-started bare worklet can crash the native runtime.
      await service.initializeLLM();
      await service.initializeWhisper();
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

  // LLM is the bulk of the download (~400MB) vs Whisper (~40MB); weight it.
  const combinedProgress = Math.round(
    state.llmDownloadProgress * 0.9 + state.whisperDownloadProgress * 0.1
  );

  return {
    ...state,
    service,
    isReady,
    isWhisperReady,
    isDownloading,
    isPreparing,
    combinedProgress,
    initialize,
  };
}

export default useQVAC;
