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
import { z } from 'zod';

/**
 * We download model weights over plain HTTPS with React Native's own
 * networking (expo-file-system) instead of QVAC's `downloadAsset`, whose
 * `registry://` source pulls over a Hyperswarm/DHT P2P transport that crashes
 * the bare worklet on iOS. Once the file is on disk we hand the local path to
 * `loadModel`, which mmaps it directly (no worklet networking involved).
 *
 * URLs + sizes are derived from the SDK's QWEN3_600M_INST_Q4 / WHISPER_TINY
 * descriptors (registry blob → Hugging Face `resolve` URL).
 */
const MODELS = {
  llm: {
    url: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/Qwen3-0.6B-Q4_0.gguf',
    name: 'Qwen3-0.6B-Q4_0.gguf',
    size: 382156480,
  },
  whisper: {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin',
    name: 'ggml-tiny.bin',
    size: 77691713,
  },
} as const;

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
      this.setState({ llmStatus: 'downloading', llmDownloadProgress: 0, error: null });

      const modelPath = await this.ensureLocalModel(MODELS.llm, (pct) =>
        this.setState({ llmDownloadProgress: pct })
      );

      console.log('[QVAC] LLM: loadModel start', modelPath);
      this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });

      this.llmModelId = await loadModel({
        modelSrc: modelPath,
        modelType: 'llamacpp-completion',
        modelConfig: {
          // NOTE: 'gpu' (Metal) crashed the worklet on load on this device;
          // 'cpu' is the safe path. Revisit GPU once the Metal path is verified.
          device: 'cpu',
          ctx_size: 2048,
          tools: true,
          verbosity: VERBOSITY.ERROR,
        },
      });

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

      const modelPath = await this.ensureLocalModel(MODELS.whisper, (pct) =>
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
