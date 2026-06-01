// services/QVACService.ts
import {
  loadModel,
  completion,
  transcribe,
  unloadModel,
  downloadAsset,
  QWEN3_600M_INST_Q4,
  WHISPER_TINY,
  VERBOSITY,
} from '@qvac/sdk';
import type { ModelProgressUpdate } from '@qvac/sdk';
import { z } from 'zod';

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

  // --- LLM lifecycle ---

  async initializeLLM(): Promise<void> {
    if (this.state.llmStatus === 'ready' || this.state.llmStatus === 'downloading' || this.state.llmStatus === 'loading') {
      return;
    }

    try {
      this.setState({ llmStatus: 'downloading', llmDownloadProgress: 0, error: null });

      await downloadAsset({
        assetSrc: QWEN3_600M_INST_Q4,
        onProgress: (progress: ModelProgressUpdate) => {
          this.setState({ llmDownloadProgress: Math.round(progress.percentage) });
        },
      });

      this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });

      this.llmModelId = await loadModel({
        modelSrc: QWEN3_600M_INST_Q4,
        modelType: 'llamacpp-completion',
        modelConfig: {
          device: 'gpu',
          ctx_size: 4096,
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

      await downloadAsset({
        assetSrc: WHISPER_TINY,
        onProgress: (progress: ModelProgressUpdate) => {
          this.setState({ whisperDownloadProgress: Math.round(progress.percentage) });
        },
      });

      this.setState({ whisperStatus: 'loading', whisperDownloadProgress: 100 });

      this.whisperModelId = await loadModel({
        modelSrc: WHISPER_TINY,
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
    /** Called for every token as it streams in. Presence enables streaming. */
    onToken?: (token: string) => void;
  }): Promise<{ text: string; toolCalls: QVACToolCall[] }> {
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

    const stream = !!params.onToken;
    const result = completion({
      modelId: this.llmModelId,
      history: params.messages,
      stream,
      tools: toolDefs.length ? toolDefs : undefined,
    });

    // Collect the full text (streaming token-by-token when a callback is set)
    let fullText = '';
    if (stream) {
      for await (const token of result.tokenStream) {
        fullText += token;
        params.onToken!(token);
      }
    } else {
      fullText = await result.text;
    }

    // Resolve tool calls. Financial tools (requiresConfirmation) are returned
    // as `pending` instead of being auto-invoked, so the UI can confirm first.
    const toolCalls = await result.toolCalls;
    const executedCalls: QVACToolCall[] = [];

    for (const call of toolCalls) {
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

    return { text: fullText, toolCalls: executedCalls };
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
