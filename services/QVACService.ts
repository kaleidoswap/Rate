// services/QVACService.ts
import {
  loadModel,
  completion,
  transcribe,
  unloadModel,
  cancel,
  VERBOSITY,
} from '@qvac/sdk';
import { File, Directory, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import {
  QVAC_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
  hfUrlFromDescriptor,
  type QVACModel,
} from './qvacModels';

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
const WHISPER_MODEL = {
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin',
  name: 'ggml-tiny.bin',
  size: 77691713,
};

const CONFIG_KEY = 'qvac.config.v1';

export interface QVACConfig {
  /** Selected chat model id (see qvacModels.ts). */
  modelId: string;
  /** Route inference to a remote P2P provider instead of running on-device. */
  delegateEnabled: boolean;
  /** Public key of the QVAC provider to delegate to (from `startQVACProvider`). */
  providerPublicKey: string;
}

const DEFAULT_CONFIG: QVACConfig = {
  modelId: DEFAULT_MODEL_ID,
  delegateEnabled: false,
  providerPublicKey: '',
};

export type ModelStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error';

export interface QVACState {
  llmStatus: ModelStatus;
  whisperStatus: ModelStatus;
  llmDownloadProgress: number;
  whisperDownloadProgress: number;
  error: string | null;
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

  private config: QVACConfig = { ...DEFAULT_CONFIG };
  private configLoaded = false;

  private state: QVACState = {
    llmStatus: 'not_downloaded',
    whisperStatus: 'not_downloaded',
    llmDownloadProgress: 0,
    whisperDownloadProgress: 0,
    error: null,
  };

  private listeners = new Set<StateListener>();

  private constructor() {}

  static getInstance(): QVACService {
    if (!QVACService.instance) {
      QVACService.instance = new QVACService();
    }
    return QVACService.instance;
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

  async loadConfig(): Promise<QVACConfig> {
    if (this.configLoaded) return this.getConfig();
    try {
      const raw = await AsyncStorage.getItem(CONFIG_KEY);
      if (raw) this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {
      /* use defaults */
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
    await this.saveConfig();
    await this.reloadLLM();
  }

  /** Unload + re-initialize the LLM (after a model/delegation change). */
  private async reloadLLM(): Promise<void> {
    await this.unloadLLM().catch(() => {});
    this.setState({ llmStatus: 'not_downloaded', llmDownloadProgress: 0, error: null });
    await this.initializeLLM();
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

    // Poll the partial file for rough download progress (the new
    // expo-file-system download API has no progress callback).
    const poll = setInterval(() => {
      try {
        if (file.exists) {
          const written = file.info().size ?? 0;
          const pct = Math.min(99, Math.round((written / model.size) * 100));
          onProgress(pct);
        }
      } catch { /* ignore */ }
    }, 1000);

    try {
      console.log(`[QVAC] downloading ${model.name} via https…`);
      const downloaded = await File.downloadFileAsync(model.url, dir, { idempotent: true } as any);
      onProgress(100);
      console.log(`[QVAC] downloaded ${model.name}`);
      return downloaded.uri.replace('file://', '');
    } finally {
      clearInterval(poll);
    }
  }

  // --- LLM lifecycle ---

  async initializeLLM(): Promise<void> {
    if (this.state.llmStatus === 'ready' || this.state.llmStatus === 'downloading' || this.state.llmStatus === 'loading') {
      return;
    }

    try {
      await this.loadConfig();
      const model = getModelById(this.config.modelId);
      const delegating = this.config.delegateEnabled && !!this.config.providerPublicKey;

      let modelSrc: any;
      if (delegating) {
        // Weights are resolved/loaded on the remote provider — pass the SDK
        // descriptor; the phone downloads nothing.
        this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });
        modelSrc = model.descriptor;
        console.log('[QVAC] LLM: delegating', model.id, '→', this.config.providerPublicKey.slice(0, 12) + '…');
      } else {
        if (!model.localCapable) {
          throw new Error(
            `${model.label} has no direct download — enable P2P delegation or pick a downloadable model.`
          );
        }
        this.setState({ llmStatus: 'downloading', llmDownloadProgress: 0, error: null });
        const url = hfUrlFromDescriptor(model.descriptor)!;
        modelSrc = await this.ensureLocalModel(
          { url, name: model.descriptor.modelId, size: model.descriptor.expectedSize },
          (pct) => this.setState({ llmDownloadProgress: pct })
        );
        console.log('[QVAC] LLM: loadModel start', modelSrc);
        this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });
      }

      this.llmModelId = await loadModel({
        modelSrc,
        modelType: 'llamacpp-completion',
        modelConfig: {
          // Local on iPhone: 'cpu' (Metal failed to init the llamacpp context in
          // the bare worklet). Delegated: the provider (e.g. a Mac) can use GPU.
          device: delegating ? 'gpu' : 'cpu',
          ctx_size: 2048,
          tools: true,
          verbosity: VERBOSITY.ERROR,
        },
        ...(delegating
          ? {
              delegate: {
                providerPublicKey: this.config.providerPublicKey,
                fallbackToLocal: false,
              },
            }
          : {}),
      } as any);

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
    if (this.state.whisperStatus === 'ready' || this.state.whisperStatus === 'downloading' || this.state.whisperStatus === 'loading') {
      return;
    }

    try {
      this.setState({ whisperStatus: 'downloading', whisperDownloadProgress: 0, error: null });

      const modelPath = await this.ensureLocalModel(WHISPER_MODEL, (pct) =>
        this.setState({ whisperDownloadProgress: pct })
      );

      console.log('[QVAC] Whisper: loadModel start', modelPath);
      this.setState({ whisperStatus: 'loading', whisperDownloadProgress: 100 });

      this.whisperModelId = await loadModel({
        modelSrc: modelPath,
        modelType: 'whispercpp-transcription',
        modelConfig: {
          language: 'en',
          strategy: 'greedy',
          audio_format: 's16le',
        },
      });

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
    const text = (final.contentText || streamed).trim();

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

  /** Cancel an in-flight completion by its requestId (for a stop button). */
  async cancelRequest(requestId: string): Promise<void> {
    try {
      await cancel({ requestId });
    } catch (err) {
      console.warn('QVAC cancel failed:', err);
    }
  }

  // --- Transcription ---

  async transcribeAudio(audioUri: string): Promise<string> {
    if (!this.whisperModelId) {
      throw new Error('Whisper model not loaded');
    }

    return await transcribe({
      modelId: this.whisperModelId,
      audioChunk: audioUri,
    });
  }

  // --- Cleanup ---

  async unloadLLM(): Promise<void> {
    if (this.llmModelId) {
      await unloadModel({ modelId: this.llmModelId, clearStorage: false });
      this.llmModelId = null;
      this.setState({ llmStatus: 'not_downloaded' });
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
    await Promise.all([this.unloadLLM(), this.unloadWhisper()]);
  }
}

export default QVACService;
