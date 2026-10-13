import { prismoText } from '../../localization/prismo';
import { toVoiceMessage, toChatMessage, type VoiceMessage } from '../../services/prismoConversation';
import type { ChatMessage } from '../chat/MessageBubble';
import { useAppLanguage } from '../../localization/useAppLanguage';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Alert,
  Clipboard,
  Share,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { voiceDiagnosticReport, type VoiceStage } from '../../services/voiceDiagnostics';
import * as Haptics from 'expo-haptics';
import { speak as qvacSpeak, stopSpeak as stopNativeSpeech } from '../../services/qvacTts';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  cancelAnimation,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSelector } from 'react-redux';
import { theme } from '../../theme';
import Markdown from 'react-native-markdown-display';
import { MindCharacter, MindCharacterBadge } from '../mind/MindCharacter';
import { voiceMood, toolResultFlash, MIND_FLASH_MS, type MindFlash } from '../mind/mindMood';
import { PrismoAnimatedCharacter, type PrismoAnimationRef } from '../mind/PrismoAnimatedCharacter';
import { useAppSelector } from '../../store/hooks';
import { voiceStatus } from './voiceStatus';
import { PayableCard } from '../chat/PayableCard';
import FunctionResultCard from '../chat/FunctionResultCard';
import { findPayable, stripPayable } from '../../utils/decodeInvoice';
import VoiceInput, { VoiceInputRef } from '../VoiceInput';
import { useQVAC } from '../../hooks/useQVAC';
import { createMindAgent } from '../../services/mindAgent';
import { getModelById } from '../../services/qvacModels';
import { startHandsFreeVoice, type HandsFreeController } from '../../services/handsFreeVoice';
import { selectMindConfig, selectAiEnabled } from '../../store/slices/settingsSlice';
import { useAiConfirm } from '../../hooks/useAiConfirm';
import PaymentConfirmationModal from '../PaymentConfirmationModal';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';
type Bubble = VoiceMessage;

/** Tool results that get a structured card (and a short spoken summary) in voice. */
const MERCHANT_TOOLS = ['find_merchant_locations', 'get_merchant_info'];

/**
 * If a turn called a merchant tool, return its structured result plus a SHORT
 * line to speak/show — so the model doesn't read the whole list aloud; the card
 * carries the detail instead.
 */
function merchantCardFrom(res: any): { name: string; result: any; spoken: string } | null {
  const calls = res?.toolCalls;
  if (!Array.isArray(calls)) return null;
  const call = [...calls].reverse().find((c: any) => MERCHANT_TOOLS.includes(c?.name));
  if (!call) return null;
  const n = call.result?.merchants?.length ?? 0;
  const spoken =
    n > 0
      ? `Found ${n} Bitcoin-accepting merchant${n === 1 ? '' : 's'} nearby — they're on the card below.`
      : "I couldn't find any Bitcoin-accepting merchants nearby right now.";
  return { name: call.name, result: call.result, spoken };
}

let _id = 0;
const nextId = () => `${Date.now()}-${_id++}`;

// Markdown styling for assistant replies, so **bold**, lists and `code` render
// cleanly instead of showing raw markup. Tuned to the assistant bubble.
const mdStyles = {
  body: { color: theme.colors.text.primary, fontSize: 15, lineHeight: 21 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  strong: { fontWeight: '700' as const, color: theme.colors.text.primary },
  em: { fontStyle: 'italic' as const },
  bullet_list: { marginTop: 2, marginBottom: 6 },
  ordered_list: { marginTop: 2, marginBottom: 6 },
  // Each row lays its marker beside the content so wrapped lines stay aligned.
  list_item: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, marginVertical: 2 },
  bullet_list_icon: { color: theme.colors.primary[500], marginRight: 8, marginLeft: 2, lineHeight: 21, fontSize: 15 },
  bullet_list_content: { flex: 1 },
  ordered_list_icon: { color: theme.colors.primary[500], marginRight: 8, marginLeft: 2, lineHeight: 21, fontSize: 15, fontWeight: '700' as const },
  ordered_list_content: { flex: 1 },
  link: { color: theme.colors.text.link, textDecorationLine: 'underline' as const },
  code_inline: {
    backgroundColor: theme.colors.surface.tertiary,
    color: theme.colors.text.primary,
    borderRadius: 4,
    paddingHorizontal: 4,
    fontSize: 13,
  },
  fence: {
    backgroundColor: theme.colors.surface.tertiary,
    color: theme.colors.text.primary,
    borderWidth: 0,
    borderRadius: 8,
    padding: 8,
  },
  heading1: { fontSize: 17, fontWeight: '700' as const, color: theme.colors.text.primary, marginVertical: 4 },
  heading2: { fontSize: 16, fontWeight: '700' as const, color: theme.colors.text.primary, marginVertical: 4 },
};

/** Shown when the model returns nothing — far friendlier than a blunt "Done." */
const NO_ANSWER_FALLBACK = "Sorry, I can't help with that just yet. Try rephrasing, or ask me about your balance, payments, or Bitcoin merchants.";

/** Turn a raw model/runtime error into something a person can act on. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/context window|prompt tokens|exceeds the|context length|too long/i.test(msg)) {
    return 'That conversation got too long for the on-device model. Tap ✕ to start a fresh one, then try again.';
  }
  if (/cancel/i.test(msg)) return 'Stopped.';
  return msg || 'Something went wrong. Please try again.';
}

interface VoiceAgentOverlayProps {
  visible: boolean;
  /** Development-only visual review; never starts native audio or inference. */
  preview?: boolean;
  messages?: ChatMessage[];
  onMessagesChange?: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onClose: () => void;
  /** Start listening as soon as the on-device AI is ready (press-and-hold entry). */
  autoListen?: boolean;
}

/**
 * Wrapper: only mount the session (and its QVAC/audio init) once opened, so the
 * dashboard stays light and nothing audio-related runs until the user taps the mic.
 */
export const VoiceAgentOverlay: React.FC<VoiceAgentOverlayProps> = ({ visible, ...props }) =>
  visible ? <VoiceAgentSession {...props} /> : null;

const VoiceAgentSession: React.FC<Omit<VoiceAgentOverlayProps, 'visible'>> = ({ onClose, autoListen, messages, onMessagesChange, preview }) => {
  const isPreview = __DEV__ && preview === true;
  const qvac = useQVAC(!isPreview);
  const aiEnabled = useAppSelector(selectAiEnabled);
  // Same KaleidoMind funnel AND settings as the chat screen — fast-path,
  // recipes, contract wallet tools, memory + on-device RAG, confirm gate,
  // persona/sampling/toggles. Settings are read per turn through the ref.
  const mindConfig = useSelector(selectMindConfig);
  const btcPriceUSD = useSelector((s: any) => s?.wallet?.btcPriceUSD) || 0;
  const mindConfigRef = useRef(mindConfig);
  mindConfigRef.current = mindConfig;
  const agent = useMemo(
    () => createMindAgent(qvac.service, () => mindConfigRef.current),
    [qvac.service],
  );
  const voiceRef = useRef<VoiceInputRef>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const characterRef = useRef<PrismoAnimationRef>(null);
  const { t } = useAppLanguage();
  const [voiceFailure, setVoiceFailure] = useState<string | null>(null);
  const onVoiceFallback = (detail: string) => setVoiceFailure(detail);
  const onVoiceStage = (stage: VoiceStage) => setVoiceEngine(t(stage === 'loading' ? 'Loading voice · first use may take a few minutes' : 'Generating voice…'));
  const onVoicePreparing = () => { setVoiceFailure(null); setVoiceEngine(prismoText("Preparing Supertonic 3…")); };
  const [voiceEngine, setVoiceEngine] = useState('');
  const onVoiceEngine = (engine: 'supertonic' | 'system', reason?: 'language' | 'unavailable') => setVoiceEngine(engine === 'supertonic' ? 'Supertonic 3' : reason === 'unavailable' ? prismoText("System voice · Supertonic unavailable") : prismoText("System voice"));
  const pendingSpeech = useRef<(() => void) | null>(null);
  const onSpeechLevel = useCallback((level: number) => characterRef.current?.setLevel(level), []);
  const stopSpeak = useCallback(async () => {
    onSpeechLevel(0);
    const pending = pendingSpeech.current; pendingSpeech.current = null;
    await stopNativeSpeech();
    pending?.();
  }, [onSpeechLevel]);

  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const bubbles = useMemo(() => (messages ?? localMessages).map(toVoiceMessage), [messages, localMessages]);
  const setBubbles = (update: (previous: Bubble[]) => Bubble[]) => {
    if (!aliveRef.current) return;
    (onMessagesChange ?? setLocalMessages)(previous => update(previous.map(toVoiceMessage)).map(toChatMessage));
  };
  const [error, setError] = useState<string | null>(null);
  // Which assistant bubbles have their reasoning expanded (tap to reveal). A
  // value of `undefined` means "auto" — expanded live while reasoning, then
  // collapsed once the answer arrives (the Claude-style behaviour).
  const [openThinking, setOpenThinking] = useState<Record<string, boolean>>({});
  // The assistant bubble currently being generated (drives the live auto-expand).
  const [activeId, setActiveId] = useState<string | null>(null);

  // Long-press / tap-to-copy for any bubble's text.
  const copyText = useCallback((text: string) => {
    const t = text?.trim();
    if (!t) return;
    Clipboard.setString(t);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  // Continuous hands-free mode (Whisper VAD streaming) — distinct from the
  // push-to-talk orb, which keeps working when this is off.
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef<HandsFreeController | null>(null);
  const handsFreeStart = useRef<AbortController | null>(null);
  const [voiceStarting, setVoiceStarting] = useState(false);
  // Money actions: one shared sheet. Listening pauses while it is open; in
  // hands-free mode the readback is spoken, but approval is always a tap.
  const confirmGate = useAiConfirm({
    thresholdSats: mindConfig.confirmAuthThresholdSats,
    onOpen: (readback) => {
      voiceRef.current?.cancelListening?.();
      const hf = handsFreeRef.current;
      if (hf) {
        hf.setPaused(true);
        void stopSpeak();
        void qvacSpeak(readback.spoken, { onEngine: onVoiceEngine, onFallback: onVoiceFallback, onPreparing: onVoicePreparing, onStage: onVoiceStage, onStart: () => setPhase('speaking'), onLevel: onSpeechLevel, onDone: () => setPhase('idle'), onError: () => setPhase('idle') });
      }
    },
    onClose: () => handsFreeRef.current?.setPaused(false),
  });
  // Latest bubbles, read inside the hands-free respond closure (created once
  // when the loop starts) to build turn history without a stale snapshot.
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

  // True while the session is mounted — guards the speak→listen loop so a late
  // TTS callback can't start the recorder after the overlay has closed.
  const aliveRef = useRef(true);
  // The in-flight inference request id (from onStart) so we can abort it when the
  // overlay closes — otherwise the model keeps "thinking" in the background and
  // speaks its answer minutes later, anywhere in the app.
  const requestIdRef = useRef<string | null>(null);
  const turnEpoch = useRef(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const pulse = useSharedValue(0);
  const micLevel = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const [moodFlash, setMoodFlash] = useState<MindFlash>(null);
  const moodFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMood = useCallback((f: MindFlash) => {
    if (!f) return;
    if (moodFlashTimer.current) clearTimeout(moodFlashTimer.current);
    setMoodFlash(f);
    moodFlashTimer.current = setTimeout(() => setMoodFlash(null), MIND_FLASH_MS);
  }, []);
  useEffect(() => () => {
    if (moodFlashTimer.current) clearTimeout(moodFlashTimer.current);
  }, []);
  // Confirm-gate wiring for one turn that also lets Prismo react to outcomes.
  const turnToolHooks = () => {
    const approvals = new Map<string, boolean>();
    return {
      onConfirm: async (call: { name: string; arguments: Record<string, unknown> }) => {
        const decision = await confirmGate.request(call);
        approvals.set(call.name, decision.approved);
        return decision;
      },
      onToolResult: (event: { name: string; arguments: Record<string, unknown>; result: unknown }) => {
        confirmGate.onToolResult(event);
        if (approvals.get(event.name) !== false) {
          flashMood(toolResultFlash(event.result, approvals.get(event.name) === true));
        }
      },
    };
  };
  // Drive the ring animation from the current phase.
  useEffect(() => {
    cancelAnimation(pulse);
    if (reduceMotion) {
      pulse.value = 0;
    } else if (phase === 'listening') {
      pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else if (phase === 'speaking') {
      pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else if (phase === 'thinking') {
      // A slow pulse in the thinking colour, under Prismo's thinking pose.
      pulse.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [phase, reduceMotion]);

  // Clean up audio when the session unmounts (i.e. the overlay is closed).
  useEffect(
    () => () => {
      void stopSpeak();
      voiceRef.current?.cancelListening?.();
      handsFreeStart.current?.abort();
      handsFreeStart.current = null;
      handsFreeRef.current?.stop();
      // Abort any in-flight inference so it can't finish + speak after close.
      if (requestIdRef.current) {
        void qvac.service?.cancelRequest?.(requestIdRef.current).catch(() => {});
        requestIdRef.current = null;
      }
    },
    []
  );

  // On open, pre-warm BOTH the STT model and the mic/audio session, so the first
  // utterance transcribes immediately and the first recording starts hot. Without
  // the audio warm-up the first clip captured silence ("can't fetch my voice the
  // first time") because the recording session was cold (and the mic-permission
  // prompt raced with auto-listen).
  useEffect(() => {
    if (!aiEnabled || isPreview) return;
    void qvac.service?.initializeWhisper?.().catch(() => {});
    // Permission and microphone activation happen only in the cancellable start path.
  }, []);

  // Voice entry: begin the hands-free conversation only once BOTH the chat model and
  // Whisper are ready. Starting the native recorder while Whisper was still
  // cold made the UI say "Listening" even though the first utterance could not
  // be consumed reliably.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!isPreview && autoListen && qvac.isReady && qvac.isWhisperReady && phase === 'idle' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void stopSpeak();
      setError(null);
      void startHandsFree();
    }
  }, [autoListen, qvac.isReady, qvac.isWhisperReady, phase]);

  const appendBubble = (role: Bubble['role'], text: string) => {
    const id = nextId();
    setBubbles((p) => [...p, { id, role, text, isUser: role === 'user', timestamp: new Date() }]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return id;
  };
  const patchBubble = (id: string, patch: Partial<Bubble>) =>
    setBubbles((p) => p.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  // Keep the latest reply in view as it streams in (the user is often not
  // looking at the screen while it speaks).
  const scrollToEnd = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

  // After a spoken reply ends, automatically listen again so the conversation
  // flows hands-free (turn-taking). Guarded so it never fires once closed.
  const resumeListening = useCallback(() => {
    if (!aliveRef.current || AppState.currentState !== 'active') return;
    setPhase('idle');
    setError(null);
    voiceRef.current?.startListening();
  }, []);

  const runTurn = useCallback(
    async (userText: string) => {
      const epoch = ++turnEpoch.current;
      setError(null);
      appendBubble('user', userText);
      const priorHistory = bubbles.map((b) => ({ role: b.role, content: b.text }));
      setPhase('thinking');
      const assistantId = appendBubble('assistant', '');
      setActiveId(assistantId);
      let streamed = '';
      let reasoning = '';
      try {
        const res = await agent.runTurn(userText, {
          history: priorHistory,
          onStart: (id) => { requestIdRef.current = id; },
          onToken: (tok) => {
            // Stream the answer into the bubble live + keep it scrolled into view.
            streamed += tok;
            patchBubble(assistantId, { text: streamed });
            scrollToEnd();
          },
          onThinking: (tok) => {
            reasoning += tok;
            patchBubble(assistantId, { thinking: reasoning });
            scrollToEnd();
          },
          ...turnToolHooks(),
        });
        requestIdRef.current = null;
        confirmGate.reset();
        // If the overlay closed mid-turn, don't patch/speak a stale answer.
        if (!aliveRef.current || epoch !== turnEpoch.current) return;
        // Merchant results → structured card + short spoken summary (no reading
        // the raw list aloud); everything else speaks the model's reply.
        const merchant = merchantCardFrom(res);
        const finalText = merchant
          ? merchant.spoken
          : (res.text?.trim() || streamed.trim() || NO_ANSWER_FALLBACK);
        patchBubble(assistantId, {
          text: finalText,
          ...(merchant ? { functionCalled: merchant.name, functionResult: merchant.result } : {}),
        });
        setActiveId(null);
        scrollToEnd();
        // Speak the reply with on-device QVAC TTS (falls back to the system
        // voice automatically if QVAC TTS isn't available). When it finishes,
        // listen again so the user can simply keep talking.
        setPhase('speaking');
        void stopSpeak();
        void qvacSpeak(finalText, {
          onEngine: onVoiceEngine, onFallback: onVoiceFallback, onPreparing: onVoicePreparing, onStage: onVoiceStage, onLevel: onSpeechLevel,
          onDone: resumeListening,
          onError: () => setPhase('idle'),
        });
      } catch (e) {
        requestIdRef.current = null;
        confirmGate.reset();
        if (!aliveRef.current) return;
        patchBubble(assistantId, { text: '' });
        setActiveId(null);
        setError(friendlyError(e));
        setPhase('idle');
      }
    },
    [bubbles, agent, resumeListening, onSpeechLevel]
  );

  // VoiceInput callbacks
  const onResult = (text: string) => {
    const t = text?.trim();
    if (!t) {
      setPhase('idle');
      return;
    }
    void runTurn(t);
  };

  const toggleListening = () => {
    if (isPreview) {
      appendBubble('user', 'E quanto posso spendere?');
      appendBubble('assistant', 'Nella demo hai 120.000 sats disponibili. Questa risposta rimane anche nella chat.');
      return;
    }
    if (qvac.llmStatus === 'error') {
      // Retry model init.
      setError(null);
      qvac.initialize();
      return;
    }
    if (qvac.whisperStatus === 'error') {
      setError(null);
      void qvac.service.initializeWhisper();
      return;
    }
    if (!qvac.isReady || !qvac.isWhisperReady) return;
    if (handsFree || voiceStarting) { pauseVoice(); return; }
    if (phase === 'listening') {
      voiceRef.current?.stopListening();
    } else if (phase === 'idle') {
      void stopSpeak();
      setError(null);
      voiceRef.current?.startListening();
    } else if (phase === 'speaking') {
      // interrupt the spoken reply and listen again
      void stopSpeak();
      voiceRef.current?.startListening();
    }
  };

  // ── Hands-free (continuous VAD) ─────────────────────────────────────────────
  // Resolve when the spoken reply finishes playing (onDone), so the loop's mic
  // re-gate + cooldown timing stays correct.
  const speakHandsFree = (text: string): Promise<void> =>
    new Promise((resolve) => {
      if (!aliveRef.current || AppState.currentState !== 'active' || !text.trim()) { resolve(); return; }
      pendingSpeech.current = resolve;
      const finish = () => { if (pendingSpeech.current === resolve) pendingSpeech.current = null; resolve(); };
      void qvacSpeak(text, { onEngine: onVoiceEngine, onFallback: onVoiceFallback, onPreparing: onVoicePreparing, onStage: onVoiceStage, onLevel: onSpeechLevel, onDone: finish, onError: finish });
    });

  // Run one turn for a transcribed utterance and return the reply text — same
  // agent/settings/confirm-gate as chat + push-to-talk, streamed into a bubble.
  const respondHandsFree = async (transcript: string): Promise<string> => {
    const epoch = ++turnEpoch.current;
    appendBubble('user', transcript);
    const priorHistory = bubblesRef.current.map((b) => ({ role: b.role, content: b.text }));
    const assistantId = appendBubble('assistant', '');
    setActiveId(assistantId);
    let streamed = '';
    let reasoning = '';
    try {
      const res = await agent.runTurn(transcript, {
        history: priorHistory,
        onStart: (id) => { requestIdRef.current = id; },
        onToken: (tok) => {
          streamed += tok;
          patchBubble(assistantId, { text: streamed });
          scrollToEnd();
        },
        onThinking: (tok) => {
          reasoning += tok;
          patchBubble(assistantId, { thinking: reasoning });
          scrollToEnd();
        },
        ...turnToolHooks(),
      });
      requestIdRef.current = null;
      if (!aliveRef.current || epoch !== turnEpoch.current) return '';
      const merchant = merchantCardFrom(res);
      const finalText = merchant
        ? merchant.spoken
        : (res.text?.trim() || streamed.trim() || NO_ANSWER_FALLBACK);
      patchBubble(assistantId, {
        text: finalText,
        ...(merchant ? { functionCalled: merchant.name, functionResult: merchant.result } : {}),
      });
      scrollToEnd();
      return finalText;
    } finally {
      confirmGate.reset();
      setActiveId(null);
    }
  };

  const stopHandsFree = () => {
    handsFreeStart.current?.abort(); handsFreeStart.current = null;
    setVoiceStarting(false);
    turnEpoch.current++;
    if (requestIdRef.current) void qvac.service?.cancelRequest?.(requestIdRef.current).catch(() => {});
    void stopSpeak();
    handsFreeRef.current?.stop();
    handsFreeRef.current = null;
    setHandsFree(false);
    setPhase('idle');
  };

  const startHandsFree = async () => {
    if (handsFreeRef.current || handsFreeStart.current || !qvac.isReady || !qvac.isWhisperReady || AppState.currentState !== 'active') return;
    const start = new AbortController();
    handsFreeStart.current = start;
    setVoiceStarting(true);
    setError(null);
    setHandsFree(true);
    void stopSpeak();
    voiceRef.current?.cancelListening?.(); // discard the other recorder's clip
    try {
      const controller = await startHandsFreeVoice({
        respond: respondHandsFree,
        speak: speakHandsFree,
        onState: (s) => { if (!start.signal.aborted && aliveRef.current) setPhase(s); },
        onError: (e) => {
          setError(e instanceof Error ? e.message : 'Voice loop stopped.');
          stopHandsFree();
        },
      }, start.signal);
      if (start.signal.aborted || !aliveRef.current || AppState.currentState !== 'active') { controller.stop(); return; }
      handsFreeRef.current = controller;
    } catch (e) {
      if (!aliveRef.current) return;
      if (start.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Could not start hands-free voice.');
      setHandsFree(false);
      setPhase('idle');
    } finally {
      if (handsFreeStart.current === start) { handsFreeStart.current = null; setVoiceStarting(false); }
    }
  };



  // Pause everything: stop the spoken reply, the mic capture, and the hands-free
  // loop, settling Prismo to idle without closing the overlay. Tap Prismo to
  // resume talking.
  const pauseVoice = () => {
    turnEpoch.current++;
    if (requestIdRef.current) void qvac.service?.cancelRequest?.(requestIdRef.current).catch(() => {});
    Haptics.selectionAsync().catch(() => {});
    void stopSpeak();
    // Cancel (discard) the mic clip rather than stop — a paused utterance must
    // NOT be transcribed and sent as a turn.
    voiceRef.current?.cancelListening?.();
    autoStartedRef.current = true;
    stopHandsFree();
    setPhase('idle');
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        turnEpoch.current++;
        void stopSpeak();
        voiceRef.current?.cancelListening?.();
        autoStartedRef.current = true;
        handsFreeStart.current?.abort(); handsFreeStart.current = null;
        setVoiceStarting(false);
        handsFreeRef.current?.stop(); handsFreeRef.current = null;
        setHandsFree(false); setPhase('idle');
        if (requestIdRef.current) void qvac.service?.cancelRequest?.(requestIdRef.current).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [stopSpeak, qvac.service]);

  // Copy the whole voice conversation (each turn's reasoning + answer) for debug.
  const copyFullChat = () => {
    const transcript = bubbles
      .map((b) => {
        const who = b.role === 'user' ? 'You' : 'KaleidoMind';
        const body = b.role === 'user'
          ? b.text.trim()
          : [b.thinking?.trim() ? `Thinking:\n${b.thinking.trim()}` : '', b.text.trim()].filter(Boolean).join('\n\n');
        return body ? `${who}:\n${body}` : '';
      })
      .filter(Boolean)
      .join('\n\n———\n\n');
    if (!transcript) return;
    Clipboard.setString(transcript);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // Show the pause control whenever the assistant is actively doing something.
  const canPause = handsFree || phase === 'listening' || phase === 'speaking' || phase === 'thinking';

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 0.1, 1], [0, 0.35, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.8]) }],
  }));

  const aiFailed = !isPreview && qvac.llmStatus === 'error';
  const speechFailed = !isPreview && qvac.whisperStatus === 'error';
  const { subtitle: modelSubtitle, status: statusText, ready: voiceReady } = voiceStatus({
    enabled: isPreview || aiEnabled, model: getModelById(qvac.config?.modelId)?.label ?? 'Local AI',
    llmStatus: isPreview ? 'ready' : qvac.llmStatus, whisperStatus: isPreview ? 'ready' : qvac.whisperStatus,
    modelProgress: qvac.combinedProgress, speechProgress: qvac.whisperDownloadProgress,
    starting: voiceStarting, phase, error,
  });
  const modelLoading = aiEnabled && !aiFailed && !speechFailed && !voiceReady;

  const mood = voiceMood({
    phase,
    failed: aiFailed || speechFailed,
    loading: modelLoading,
    hasError: !!error,
    flash: moodFlash,
  });

  const orbColor =
    phase === 'thinking' ? theme.colors.secondary?.[500] ?? '#6F32FF' : theme.colors.primary[500];

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <MindCharacterBadge size={28} mood={mood === 'sleeping' ? 'sleeping' : 'idle'} />
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>{prismoText("Prismo · Talk")}</Text>
                <Text style={styles.headerSubtitle} numberOfLines={1}>{isPreview ? "ANTEPRIMA" : prismoText("Local AI")}</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              {bubbles.length > 0 && (
                <Pressable onPress={copyFullChat} hitSlop={10} style={styles.closeBtn} accessibilityLabel={prismoText("Copy full chat")}>
                  <Ionicons name="copy-outline" size={18} color={theme.colors.text.secondary} />
                </Pressable>
              )}
              <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel={prismoText("Back to chat")}>
                <Ionicons name="close" size={20} color={theme.colors.text.secondary} />
              </Pressable>
            </View>
          </View>

          {/* Conversation */}
          <ScrollView
            ref={scrollRef}
            style={styles.convo}
            contentContainerStyle={{ paddingVertical: 12, gap: 10 }}
            showsVerticalScrollIndicator={false}
          >
            {isPreview && <Text style={styles.hint}>ANTEPRIMA · Tocca il microfono per aggiungere uno scambio di esempio.</Text>}
            {bubbles.length === 0 && (
              <Text style={styles.hint}>
                {prismoText("What's my balance?")}
              </Text>
            )}
            {bubbles.filter(b => phase !== 'speaking' || b.id !== bubbles.filter(item => item.role === 'assistant').at(-1)?.id).map((b) => {
              const hasThinking = b.role === 'assistant' && !!b.thinking?.trim();
              const hasText = !!b.text?.trim();
              if (!hasText && !hasThinking) return null;
              const isActive = b.id === activeId;
              // Live reasoning, no answer yet → show it expanded (Claude-style);
              // once the answer streams in, auto-collapse. A manual tap overrides.
              const thinkingLive = isActive && hasThinking && !hasText;
              const open = openThinking[b.id] ?? false;
              return (
                <Pressable
                  key={b.id}
                  // Long-press copies the whole bubble — reasoning AND answer when
                  // both are present, so the thinking is copyable in voice mode too.
                  onLongPress={() =>
                    copyText(
                      [hasThinking ? `Thinking:\n${b.thinking!.trim()}` : '', hasText ? b.text : '']
                        .filter(Boolean)
                        .join('\n\n'),
                    )
                  }
                  delayLongPress={300}
                  style={[styles.bubble, b.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
                >
                  {hasThinking && (
                    <View style={styles.thinkWrap}>
                      <Pressable
                        onPress={() => setOpenThinking((p) => ({ ...p, [b.id]: !open }))}
                        style={styles.thinkToggle}
                        hitSlop={6}
                      >
                        <Ionicons name="sparkles-outline" size={12} color={thinkingLive ? theme.colors.primary[500] : theme.colors.text.muted} />
                        <Text
                          style={[styles.thinkToggleText, thinkingLive && { color: theme.colors.primary[500] }]}
                        >
                          {thinkingLive ? 'Thinking…' : open ? prismoText("Hide thinking") : prismoText("Show thinking")}
                        </Text>
                        <Ionicons
                          name={open ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color={thinkingLive ? theme.colors.primary[500] : theme.colors.text.muted}
                        />
                      </Pressable>
                      {open && (
                        <View style={styles.thinkBlock}>
                          <Text style={styles.thinkText} selectable>
                            {b.thinking!.trim()}
                          </Text>
                          {/* Copy just the reasoning (only once it's settled). */}
                          {!thinkingLive && (
                            <Pressable onPress={() => copyText(b.thinking!.trim())} style={styles.copyBtn} hitSlop={8}>
                              <Ionicons name="copy-outline" size={12} color={theme.colors.text.muted} />
                              <Text style={styles.copyBtnText}>{prismoText("Copy thinking")}</Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                  {hasText && (() => {
                    // Surface a Lightning invoice / address / RGB invoice in the
                    // reply as a rich card (copy + share, lightning: link on share)
                    // instead of an unreadable, untappable raw string.
                    const payable = b.role === 'assistant' ? findPayable(b.text) : null;
                    const shown = payable ? stripPayable(b.text, payable).trim() : b.text;
                    return (
                      <>
                        {!!shown && (
                          b.role === 'user' ? (
                            <Text selectable style={styles.bubbleUserText}>{shown}</Text>
                          ) : (
                            // Render markdown so the model's **bold**, lists and
                            // `code` format properly instead of showing raw markup.
                            <Markdown style={mdStyles as any}>{shown}</Markdown>
                          )
                        )}
                        {payable && <PayableCard payable={payable} onCopy={copyText} />}
                      </>
                    );
                  })()}
                  {/* Structured tool result (e.g. merchants) as a rich card, so the
                      model never has to read the raw data aloud. */}
                  {b.functionResult && (
                    <FunctionResultCard
                      functionCalled={b.functionCalled ?? ''}
                      functionResult={b.functionResult}
                      onCopy={copyText}
                      onOpenLink={(url) => Linking.openURL(url).catch(() => {})}
                    />
                  )}
                  {/* Discoverable copy affordance on finished assistant replies. */}
                  {b.role === 'assistant' && hasText && !isActive && (
                    <Pressable onPress={() => copyText(b.text)} style={styles.copyBtn} hitSlop={8}>
                      <Ionicons name="copy-outline" size={13} color={theme.colors.text.muted} />
                      <Text style={styles.copyBtnText}>{prismoText("Copy")}</Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {phase === 'speaking' && !!bubbles.filter(b => b.role === 'assistant').at(-1)?.text && <View style={styles.speechBubbleWrap}>
            <View style={styles.speechBubble}>
              <ScrollView style={{ maxHeight: 176 }} nestedScrollEnabled><Text selectable style={styles.speechBubbleText}>{bubbles.filter(b => b.role === 'assistant').at(-1)?.text}</Text></ScrollView>
            </View>
            {/* The tail points at Prismo, who is the one speaking. */}
            <View style={styles.speechBubbleTail} />
          </View>}
          {/* Prismo follows real playback energy. */}
          <View style={styles.orbArea}>
            <Animated.View style={[styles.orbRing, { backgroundColor: orbColor }, ringStyle]} />
            <View style={phase === 'thinking' ? { opacity: 0 } : undefined}>
              <PrismoAnimatedCharacter
                ref={characterRef}
                phase={phase}
                size={184}
                accessibilityLabel={`Prismo, ${statusText}`}
                onPress={voiceStarting ? pauseVoice : voiceReady || aiFailed || speechFailed ? toggleListening : undefined}
              />
            </View>
            {/* The animated renderer has no thinking pose: show the thinking Prismo on top, the
                renderer stays mounted (and keeps taking taps) underneath. */}
            {phase === 'thinking' && <View pointerEvents="none" style={styles.thinkingCharacter}>
              <MindCharacter mood="thinking" size={184} />
            </View>}

          </View>
          {__DEV__ && !voiceReady && <Pressable accessibilityRole="button" accessibilityLabel="Prova voce italiana" style={styles.pauseBtn} onPress={() => {
            const text = 'Ciao! Sono Prismo. Questa è una prova della voce italiana. Quando parlo, la mia bocca segue le parole. Ogni pagamento richiede sempre la tua conferma.';
            appendBubble('assistant', text);
            void qvacSpeak(text, { language: 'it-IT', onEngine: onVoiceEngine, onFallback: onVoiceFallback, onPreparing: onVoicePreparing, onStage: onVoiceStage, onStart: () => setPhase('speaking'), onLevel: onSpeechLevel, onDone: () => setPhase('idle'), onError: () => setPhase('idle') });
          }}><Text style={styles.pauseBtnText}>Prova voce italiana · sviluppo</Text></Pressable>}
          {/* Loading progress bar while the on-device model downloads/loads. */}
          {modelLoading && (
            <View style={styles.loadTrack}>
              <View
                style={[
                  styles.loadFill,
                  {
                    width: `${
                      !qvac.isReady
                        ? qvac.isDownloading ? qvac.combinedProgress : 100
                        : qvac.whisperStatus === 'downloading' ? qvac.whisperDownloadProgress : 100
                    }%`,
                  },
                ]}
              />
            </View>
          )}
          <Text style={styles.status}>{prismoText(statusText)}</Text>

          {!!voiceEngine && <Text style={styles.hint}>{prismoText(voiceEngine)}</Text>}

          {!!voiceFailure && <Pressable accessibilityRole="button" onPress={() => Alert.alert('Supertonic 3', voiceFailure, [
            { text: prismoText('Close'), style: 'cancel' },
            { text: prismoText('Export diagnostics'), onPress: () => { void Share.share({ title: 'Prismo voice diagnostics', message: voiceDiagnosticReport() }).catch(() => Alert.alert('Export failed', 'Please try again.')); } },
            { text: prismoText('Retry voice'), onPress: () => {
              pauseVoice();
              void stopSpeak().then(() => {
                if (!aliveRef.current) return;
                setPhase('speaking');
                const text = 'Ciao! Sono Prismo. Proviamo la voce italiana.';
                appendBubble('assistant', text);
                void qvacSpeak(text, { onEngine: onVoiceEngine, onFallback: onVoiceFallback, onPreparing: onVoicePreparing, onStage: onVoiceStage, onLevel: onSpeechLevel, onDone: () => setPhase('idle'), onError: () => setPhase('idle') });
              });
            } },
          ])}><Text style={styles.pauseBtnText}>{t('Voice details & retry')}</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={canPause || voiceStarting ? prismoText('Pause voice') : prismoText('Start listening')}
            accessibilityState={{ disabled: !canPause && !voiceReady && !aiFailed && !speechFailed }}
            disabled={!canPause && !voiceReady && !aiFailed && !speechFailed}
            onPress={() => { if (isPreview) toggleListening(); else if (canPause || voiceStarting) pauseVoice(); else if (voiceReady) void startHandsFree(); else toggleListening(); }}
            style={{ width: 76, height: 76, borderRadius: 38, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 12, backgroundColor: theme.colors.primary[500], opacity: canPause || voiceReady || aiFailed || speechFailed ? 1 : .4 }}>
            <Ionicons name={phase === 'speaking' || phase === 'thinking' ? 'stop' : 'mic'} size={32} color={theme.colors.text.inverse} />
          </Pressable>

          {/* Hidden recorder */}
          <View style={{ height: 0, overflow: 'hidden' }}>
            <VoiceInput
              ref={voiceRef}
              onStart={() => setPhase('listening')}
              onLevel={(l) => { micLevel.value = l; }}
              onEnd={() => setPhase((p) => (p === 'listening' ? 'thinking' : p))}
              onResult={onResult}
              onPartialResult={() => {}}
              onError={(e) => {
                setError(e || 'Could not hear you. Try again.');
                setPhase('idle');
              }}
            />
          </View>

        </View>

        <PaymentConfirmationModal
          inline
          visible={!!confirmGate.state}
          readback={confirmGate.state?.readback}
          onConfirm={confirmGate.approve}
          onCancel={confirmGate.cancel}
          loading={!!confirmGate.state?.loading}
          busyLabel={confirmGate.state?.busyLabel}
          requireAuth={confirmGate.state?.requireAuth}
          priceUsd={btcPriceUSD}
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.background.secondary,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 36,
    maxHeight: '94%',
    height: '94%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text.primary },
  headerSubtitle: { fontSize: 12, color: theme.colors.text.tertiary, marginTop: 1 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
  },
  convo: { flex: 1, minHeight: 0, marginTop: 8 },
  hint: { color: theme.colors.text.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 12 },
  bubble: { maxWidth: '85%', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: theme.colors.primary[500], borderBottomRightRadius: 5 },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: theme.colors.surface.secondary, borderBottomLeftRadius: 5 },
  bubbleUserText: { color: theme.colors.text.inverse, fontSize: 15, fontWeight: '500' },
  bubbleAssistantText: { color: theme.colors.text.primary, fontSize: 15 },
  thinkWrap: { marginBottom: 8 },
  thinkToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thinkToggleText: { color: theme.colors.text.muted, fontSize: 12, fontWeight: '600' },
  thinkBlock: {
    marginTop: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary[500],
  },
  thinkText: {
    color: theme.colors.text.secondary,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  copyBtnText: { color: theme.colors.text.muted, fontSize: 12, fontWeight: '600' },
  loadTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface.secondary,
    overflow: 'hidden',
    marginTop: 10,
    marginHorizontal: 40,
  },
  loadFill: { height: '100%', borderRadius: 2, backgroundColor: theme.colors.primary[500] },
  orbArea: { alignItems: 'center', justifyContent: 'center', height: 184, marginTop: 4 },
  orbRing: { position: 'absolute', width: 92, height: 92, borderRadius: 46 },
  thinkingCharacter: { position: 'absolute', width: 184, height: 184 },
  speechBubbleWrap: { alignSelf: 'center', alignItems: 'center', maxWidth: '90%', marginTop: 8 },
  speechBubble: {
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18,
    backgroundColor: theme.colors.surface.elevated ?? theme.colors.surface.secondary,
    borderWidth: 1.5, borderColor: theme.colors.primary[500],
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  speechBubbleText: { color: theme.colors.text.primary, fontSize: 17, lineHeight: 24, fontWeight: '500' },
  speechBubbleTail: {
    width: 14, height: 14, marginTop: -8, transform: [{ rotate: '45deg' }],
    backgroundColor: theme.colors.surface.elevated ?? theme.colors.surface.secondary,
    borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: theme.colors.primary[500],
  },
  orbChip: {
    position: 'absolute',
    bottom: 6,
    right: '50%',
    marginRight: -50,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary[500],
    borderWidth: 2,
    borderColor: theme.colors.background.primary,
  },
  status: { textAlign: 'center', color: theme.colors.text.secondary, fontSize: 14, marginTop: 6, fontWeight: '500' },
  pauseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  pauseBtnText: { color: theme.colors.text.primary, fontSize: 13, fontWeight: '600' },
});

export default VoiceAgentOverlay;
