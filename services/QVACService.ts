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
import DeviceInfo from 'react-native-device-info';
import {
  QVAC_MODELS,
  DEFAULT_MODEL_ID,
  getModelById,
  hfUrlFromDescriptor,
  recommendLocalModel,
  recommendLocalModelId,
  type QVACModel,
} from './qvacModels';
import type { TurnInput, TurnOutput } from '@kaleidorg/mind';

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
  private deviceMemBytes: number | null = null;

  private state: QVACState = {
    llmStatus: 'not_downloaded',
    whisperStatus: 'not_downloaded',
    llmDownloadProgress: 0,
    whisperDownloadProgress: 0,
    error: null,
  };

  private listeners = new Set<StateListener>();

  // Master kill switch for on-device AI. Defaults OFF: starting the QVAC Bare
  // worklet on a native/JS mismatch (or on the iOS Simulator, which has no
  // bare-abort framework) aborts the process natively — an error JS can't catch.
  // App.tsx syncs this from the persisted `settings.aiEnabled` flag, so the
  // worklet can never start until the user explicitly opts in.
  private enabled = false;

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

  async loadConfig(): Promise<QVACConfig> {
    if (this.configLoaded) return this.getConfig();
    let hadSaved = false;
    try {
      const raw = await AsyncStorage.getItem(CONFIG_KEY);
      if (raw) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
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
    // Hard gate: never start the Bare worklet unless AI is explicitly enabled.
    if (!this.enabled) {
      console.log('[QVAC] LLM init skipped — on-device AI is disabled');
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
      if (!delegating && !model.localCapable) {
        const fallback = recommendLocalModel(await this.getDeviceMemoryBytes());
        console.warn(
          `[QVAC] '${model.label}' can't run on-device; falling back to '${fallback.label}'`
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
        await this.saveConfig();
        this.setState({ llmStatus: 'downloading', llmDownloadProgress: 0, error: null });
        const localUrl = hfUrlFromDescriptor(local.descriptor)!;
        const localSrc = await this.ensureLocalModel(
          { url: localUrl, name: local.descriptor.modelId, size: local.descriptor.expectedSize },
          (pct) => this.setState({ llmDownloadProgress: pct })
        );
        this.setState({ llmStatus: 'loading', llmDownloadProgress: 100 });
        this.llmModelId = await loadModel({
          modelSrc: localSrc,
          modelType: 'llamacpp-completion',
          modelConfig: { device: 'cpu', ctx_size: 2048, tools: true, verbosity: VERBOSITY.ERROR },
        } as any);
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
    // on-device AI is explicitly enabled.
    if (!this.enabled) {
      console.log('[QVAC] Whisper init skipped — on-device AI is disabled');
      return;
    }
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

  /**
   * Multi-turn agentic chat. Unlike `chat()` (single-shot), this feeds tool
   * results back to the model so it produces a natural-language answer and can
   * chain tool calls (e.g. get_balance → reason → pay). Follows the QVAC SDK
   * multi-turn pattern: push the raw assistant frame + `{role:'tool'}` results
   * to history, loop until the model stops calling tools.
   *
   * Money tools (requiresConfirmation) pause for `onConfirm` — the UI shows a
   * confirmation sheet and resolves the promise. The handler always runs on
   * THIS device (the phone), even when inference is delegated to a desktop
   * provider — keys never leave the device.
   */
  async chatAgentic(params: {
    messages: Array<{ role: string; content: string }>;
    tools?: QVACTool[];
    /** Max reasoning↔tool rounds before forcing a stop. Default 5. */
    maxTurns?: number;
    /** Visible content tokens as they stream, tagged with the current turn. */
    onToken?: (token: string, turn: number) => void;
    /** The live requestId for the current turn (so a stop button can cancel it). */
    onStart?: (requestId: string, turn: number) => void;
    /** Fired when the model requests a tool, before it executes. */
    onToolCall?: (call: { name: string; arguments: Record<string, unknown> }, turn: number) => void;
    /** Human-in-the-loop gate for money tools. Resolve to approve/decline. */
    onConfirm?: (call: {
      name: string;
      arguments: Record<string, unknown>;
    }) => Promise<{ approved: boolean; reason?: string }>;
  }): Promise<{ text: string; turns: number; toolCalls: QVACToolCall[]; requestId: string }> {
    if (!this.llmModelId) {
      throw new Error('LLM model not loaded');
    }

    const tools = params.tools ?? [];
    const toolsByName = new Map(tools.map((t) => [t.name, t]));
    const toolDefs = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      handler: t.handler,
    }));
    const maxTurns = params.maxTurns ?? 5;

    // Work on a copy — we append assistant/tool frames per the SDK pattern.
    const history: Array<{ role: string; content: string }> = [...params.messages];
    const executedCalls: QVACToolCall[] = [];
    let lastRequestId = '';
    let finalText = '';
    let turns = 0;

    for (let turn = 1; turn <= maxTurns; turn++) {
      turns = turn;

      const run = completion({
        modelId: this.llmModelId,
        history,
        stream: true,
        tools: toolDefs.length ? toolDefs : undefined,
      });
      lastRequestId = run.requestId;
      params.onStart?.(run.requestId, turn);

      let streamed = '';
      for await (const event of run.events) {
        if (event.type === 'contentDelta') {
          streamed += event.text;
          params.onToken?.(event.text, turn);
        }
      }

      const final = await run.final;
      finalText = (final.contentText || streamed).trim();

      // No tool calls → the model produced its final answer.
      if (!final.toolCalls || final.toolCalls.length === 0) {
        break;
      }

      // Anchor the next turn with the RAW assistant frame (not the cleaned
      // text) — the model needs its own tool-call framing to continue.
      history.push({ role: 'assistant', content: final.raw?.fullText ?? finalText });

      for (const call of final.toolCalls) {
        const def = toolsByName.get(call.name);
        params.onToolCall?.({ name: call.name, arguments: call.arguments }, turn);

        let result: unknown;

        if (def?.requiresConfirmation) {
          // Human-in-the-loop for anything that moves money.
          const decision = params.onConfirm
            ? await params.onConfirm({ name: call.name, arguments: call.arguments })
            : { approved: false, reason: 'no confirmation handler available' };

          if (decision.approved) {
            try {
              result = call.invoke ? await call.invoke() : await def.handler(call.arguments);
            } catch (err) {
              result = { error: err instanceof Error ? err.message : String(err) };
            }
          } else {
            result = { declined: true, reason: decision.reason ?? 'user declined' };
          }
        } else {
          // Read / safe-write tools auto-execute on this device.
          try {
            result = call.invoke ? await call.invoke() : await def?.handler(call.arguments);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }
        }

        executedCalls.push({ name: call.name, arguments: call.arguments, result });
        history.push({
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      if (turn === maxTurns && !finalText) {
        finalText = 'I had to stop after several steps — please try a more specific request.';
      }
    }

    return { text: finalText, turns, toolCalls: executedCalls, requestId: lastRequestId };
  }

  /**
   * One completion turn in the shape the shared @kaleido/mind Engine expects.
   * The Engine owns the agentic loop + tool execution; this just runs a single
   * round and returns the assistant text, the raw frame (for history push-back)
   * and any tool calls the model requested. Tools are passed as schemas only —
   * the Engine executes them via its ToolSources (so wallet signing stays here
   * on-device even when inference is delegated).
   */
  async runProviderTurn(input: TurnInput): Promise<TurnOutput> {
    if (!this.llmModelId) {
      throw new Error('LLM model not loaded');
    }

    const history = input.system
      ? [{ role: 'system', content: input.system }, ...input.messages]
      : input.messages;

    const toolDefs = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const run = completion({
      modelId: this.llmModelId,
      history,
      stream: true,
      tools: toolDefs.length ? (toolDefs as any) : undefined,
    });

    let streamed = '';
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        streamed += event.text;
        input.onToken?.(event.text);
      }
    }

    const final = await run.final;
    // Strip <think>…</think> reasoning from the user-visible text; keep the raw
    // frame (with framing) for the engine's history push-back.
    const rawText = final.contentText || streamed;
    const text = rawText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    return {
      text,
      rawContent: final.raw?.fullText ?? rawText,
      toolCalls: (final.toolCalls || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        arguments: c.arguments ?? {},
      })),
      requestId: run.requestId,
    };
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

    // The QVAC SDK's native file reader expects a plain filesystem path, not a
    // `file://` URI — same as the model-loading paths above. Passing the raw
    // URI causes AUDIO_FILE_NOT_FOUND even though the file exists.
    const audioPath = audioUri.replace('file://', '');

    return await transcribe({
      modelId: this.whisperModelId,
      audioChunk: audioPath,
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
