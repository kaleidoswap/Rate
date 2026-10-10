import { useAgentPaymentFeedback } from "../components/mind/useAgentPaymentFeedback";
// screens/AIAssistantScreen.tsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  Vibration,
  Linking,
  Clipboard,
  Keyboard,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import QVACService, { WORKLET_CRASHED_PREFIX } from '../services/QVACService';
import { KaleidoMindOnboarding, type MindAvailability } from '../components/mind/KaleidoMindOnboarding';
import { VoiceAgentOverlay } from '../components/voice-agent/VoiceAgentOverlay';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { selectAiEnabled, selectAiMode, setAiMode, selectMindConfig, selectAiOnboarded, setAiOnboarded } from '../store/slices/settingsSlice';
import { useAppTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme';
import { leading } from '../theme';
import { MainHeader, MindCharacter, MindCharacterBadge, Badge, Sheet } from '../components';
import { chatMood, toolResultFlash, MIND_FLASH_MS, type MindFlash } from '../components/mind/mindMood';
import { ChatEmptyState, MessageBubble, TypingDots, buildCopyText } from '../components/chat';
import type { ChatMessage, ChatMsgStats } from '../components/chat';
import VoiceInput, { VoiceInputRef } from '../components/VoiceInput';
import { IntentBar } from '../components/mind/IntentBar';
import PaymentConfirmationModal from '../components/PaymentConfirmationModal';
import NostrContactsSelector from '../components/NostrContactsSelector';
import QVACSettingsSheet from '../components/QVACSettingsSheet';
import { shareLightningInvoice } from '../components/InvoiceQRCode';
import ToastService from '../services/ToastService';
import { useQVAC } from '../hooks/useQVAC';
import { getModelById } from '../services/qvacModels';
import { chatErrorMessage } from '../services/aiErrors';
import type { Message as MindMessage, Skill } from '@kaleidorg/mind';
import { createMindAgent } from '../services/mindAgent';
import { useAiConfirm } from '../hooks/useAiConfirm';
import { AgentWalletCard } from '../components/mind/AgentWalletCard';
import { stepForTool, turnProgressLabel } from '../utils/turnProgress';
import * as Haptics from 'expo-haptics';

interface Props {
  navigation: any;
  route?: { params?: { openSettings?: boolean } };
}

interface Contact {
  id: string;
  name: string;
  lightning_address?: string;
  node_pubkey?: string;
  notes?: string;
  avatar_url?: string;
  npub?: string;
  isNostrContact?: boolean;
  profile?: any;
}

const toast = () => ToastService.getInstance();

/** A `/command` token for a skill, e.g. "Merchant Finder" → "merchant-finder". */
const skillSlug = (name: string) => name.toLowerCase().trim().replace(/\s+/g, '-');
/** Keywords prepended to a turn so the funnel routes to the pinned skill. */
const skillRouteHint = (skill: Skill): string =>
  (skill.triggers && skill.triggers.length
    ? skill.triggers.slice(0, 5).join(' ')
    : skill.name.replace(/-/g, ' '));

export default function AIAssistantScreen({ navigation, route }: Props) {
  const paymentConfirmed = useAgentPaymentFeedback();
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Monotonic id source — avoids Date.now() collisions on rapid sends.
  const idCounter = useRef(0);
  const nextId = useCallback(() => {
    idCounter.current += 1;
    return `m${idCounter.current}`;
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isVoiceAvailable, setIsVoiceAvailable] = useState(true);
  const [partialText, setPartialText] = useState('');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [baseInputText, setBaseInputText] = useState('');

  // Collapsible quick actions (hidden by default once a chat is going).
  const [showActions, setShowActions] = useState(false);

  // Nostr contacts state
  const [showContactsSelector, setShowContactsSelector] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const voiceInputRef = useRef<VoiceInputRef>(null);
  // Most recent successfully generated invoice — lets "share" act on it.
  const lastInvoiceRef = useRef<{ invoice: string; amount: number; description?: string } | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);

  // MainHeader sits above the KeyboardAvoidingView; its height (safe-area top +
  // ~70 of bar padding/content) is the vertical offset the keyboard must clear
  // so the input + typed text stay visible. The old hardcoded 90 was wrong on
  // notched devices, hiding the input behind the keyboard.
  const insets = useSafeAreaInsets();
  const headerOffset = insets.top + 70;

  // On-device QVAC: model lifecycle + wallet tools.
  // Only auto-start the Bare worklet when the user has explicitly enabled AI
  // (off by default) — starting it on a native/JS mismatch hard-crashes the app.
  const aiEnabled = useSelector(selectAiEnabled);
  const aiMode = useSelector(selectAiMode);
  const btcPriceUSD = useSelector((s: any) => s?.wallet?.btcPriceUSD) || 0;
  const mindConfig = useSelector(selectMindConfig);
  const dispatch = useDispatch();
  const aiOnboarded = useSelector(selectAiOnboarded);
  const [mindOnboardingOpen, setMindOnboardingOpen] = useState(false);
  const [mindAvailability, setMindAvailability] = useState<MindAvailability | null>(null);
  const [voiceAgentOpen, setVoiceAgentOpen] = useState(false);
  const openMindSetup = useCallback(async () => {
    const availability = await QVACService.getInstance().getAvailability().catch(() => null);
    setMindAvailability(availability);
    setMindOnboardingOpen(true);
  }, []);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (!aiOnboarded) {
      QVACService.getInstance().getAvailability().catch(() => null).then((availability) => {
        if (active) { setMindAvailability(availability); setMindOnboardingOpen(true); }
      });
    }
    return () => { active = false; setMindOnboardingOpen(false); setVoiceAgentOpen(false); };
  }, [aiOnboarded]));
  const finishMindSetup = () => {
    dispatch(setAiOnboarded(true));
    setMindOnboardingOpen(false);
  };
  const qvac = useQVAC(aiEnabled);
  // Shared KaleidoMind agent — the SAME funnel the voice overlay uses (fast-path
  // → recipes → skill-scoped agentic loop over wallet/merchant/memory/RAG/skill
  // tools). User settings are read per turn through the ref, so tweaking them
  // in the sheet never rebuilds the engine or drops the in-memory RAG index.
  const mindConfigRef = useRef(mindConfig);
  mindConfigRef.current = mindConfig;
  const agent = useMemo(
    () => createMindAgent(qvac.service, () => mindConfigRef.current),
    [qvac.service],
  );

  // Skills the user can pin to a message (like a `/command`). Pinning one routes
  // the funnel to that skill so the model gets its instructions for the turn.
  const skills = useMemo<Skill[]>(() => {
    try { return agent.listSkills(); } catch { return []; }
  }, [agent]);
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);

  // requestId of the in-flight completion, used to cancel via the stop button
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // AI settings sheet (model selection, voice). Settings → KaleidoMind
  // → "Models & privacy" opens this tab with the sheet up.
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    if (!route?.params?.openSettings) return;
    setShowSettings(true);
    navigation.setParams?.({ openSettings: undefined });
  }, [route?.params?.openSettings, navigation]);
  // Conversation history panel (desktop-parity: current conversation + new/clear).
  const [showHistory, setShowHistory] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Latest turn's real inference stats (tok/s + backend) for the header chip.
  const [lastStats, setLastStats] = useState<ChatMsgStats | null>(null);

  const isEmpty = messages.length === 0;

  const isFocused = useIsFocused();
  const [replyStreaming, setReplyStreaming] = useState(false);
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
  const liveAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].isUser) return messages[i].id;
    return null;
  }, [messages]);
  const mood = chatMood({
    aiEnabled,
    llmStatus: qvac.llmStatus,
    isGenerating: isLoading,
    isStreamingText: replyStreaming,
    flash: moodFlash,
  });

  // Step + elapsed time under the pending reply (a model step can take a minute).
  const [progress, setProgress] = useState<{ step: string; startedAt: number } | null>(null);
  const progressStep = useRef<string | null>(null);
  const [progressNow, setProgressNow] = useState(Date.now());
  useEffect(() => {
    if (!progress) return;
    setProgressNow(Date.now());
    const t = setInterval(() => setProgressNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [progress]);
  const setStep = useCallback((step: string | null) => {
    if (progressStep.current === step) return;
    progressStep.current = step;
    setProgress((p) => (step ? { step, startedAt: p?.startedAt ?? Date.now() } : null));
  }, []);
  const progressLabel = progress
    ? turnProgressLabel(progress.step, progressNow - progress.startedAt, {
        tokensPerSecond: lastStats?.tokensPerSecond,
        maxTokens: mindConfig.maxTokens,
      })
    : undefined;

  // Re-read the model config whenever this screen regains focus. reloadConfig
  // is held in a ref so the effect can depend ONLY on `navigation`.
  const reloadConfigRef = useRef(qvac.reloadConfig);
  reloadConfigRef.current = qvac.reloadConfig;

  useEffect(() => {
    const refresh = () => reloadConfigRef.current();
    refresh();
    const unsub = navigation.addListener?.('focus', refresh);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [navigation]);

  // Header subtitle: which model + where it runs + live throughput (tok/s) from
  // the last turn (real QVAC stats), mirroring the desktop chat header.
  const headerSubtitle = useMemo(() => {
    const modelLabel = getModelById(qvac.config.modelId)?.label ?? 'On-device AI';
    const tps =
      lastStats?.tokensPerSecond && lastStats.tokensPerSecond > 0
        ? ` · ${lastStats.tokensPerSecond.toFixed(0)} tok/s${lastStats.device ? ` (${lastStats.device.toUpperCase()})` : ''}`
        : '';
    return `${modelLabel} · on this device${tps}`;
  }, [qvac.config.modelId, lastStats]);


  const scrollToBottom = useCallback((animated: boolean = true) => {
    if (!scrollViewRef.current) return;
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => scrollToBottom(true));
    return () => { showSub.remove(); };
  }, [scrollToBottom]);

  // Recording pulse + duration timer
  useEffect(() => {
    if (isListening) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
      recordingTimer.current = setInterval(() => setRecordingDuration((p) => p + 1), 1000);
    } else {
      pulseAnim.setValue(1);
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      setRecordingDuration(0);
    }
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
    };
  }, [isListening, pulseAnim]);

  const addMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
    setTimeout(() => scrollToBottom(true), 100);
  }, [scrollToBottom]);

  const updateMessage = useCallback((id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));
  }, []);

  // No auto-greeting message: an empty chat shows the action-rich ChatEmptyState
  // (suggestions + quick actions) instead of a wall of welcome text.

  // ---- Voice handlers ----
  const handleSpeechStart = () => {
    setIsListening(true);
    setPartialText('');
    setBaseInputText(inputText);
    Vibration.vibrate(50);
  };

  const handleSpeechEnd = () => {
    setIsListening(false);
    setPartialText('');
    setBaseInputText('');
    Vibration.vibrate(100);
  };

  const handleSpeechResult = (text: string) => {
    if (!text.trim()) return;
    setInputText(() => {
      const cleanBaseText = baseInputText.trim();
      const cleanNewText = text.trim();
      if (cleanBaseText && cleanNewText) return `${cleanBaseText} ${cleanNewText}`;
      return cleanNewText || cleanBaseText;
    });
    setPartialText('');
  };

  const handlePartialResult = (text: string) => setPartialText(text.trim());

  const handleSpeechError = (error: string) => {
    setIsListening(false);
    setPartialText('');
    setBaseInputText('');

    let errorMessage = 'Speech recognition failed. Please try again.';
    if (error.includes('not-allowed')) {
      errorMessage = 'Microphone access denied. Please enable microphone permissions.';
      setIsVoiceAvailable(false);
    } else if (error.includes('network')) {
      errorMessage = 'Network error. Please check your connection.';
    } else if (error.includes('no-speech')) {
      errorMessage = 'No speech detected. Please speak clearly.';
    } else if (error.includes('not supported')) {
      errorMessage = 'Speech recognition is not supported on this device.';
      setIsVoiceAvailable(false);
    }
    Alert.alert('Voice Recognition Error', errorMessage);
  };

  const startListening = () => {
    if (!isVoiceAvailable) {
      Alert.alert(
        'Voice Recognition Unavailable',
        'Speech recognition is not available. Please type your message instead.',
        [{ text: 'OK' }],
      );
      return;
    }
    if (isListening) {
      stopListening();
      return;
    }
    voiceInputRef.current?.startListening();
  };

  const stopListening = () => voiceInputRef.current?.stopListening();

  // ---- Shared feedback helpers ----
  // Copy actions give a haptic tick instead of a top toast (the toast overlapped
  // the status bar on this screen). The cards have their own inline copy cues.
  const copyToClipboard = useCallback((text: string, _label: string = 'Text') => {
    if (!text) return;
    Clipboard.setString(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => toast().error('Could not open link'));
  }, []);

  const handleLongPressMessage = useCallback((message: ChatMessage) => {
    const text = buildCopyText(message);
    if (!text) return;
    Haptics.selectionAsync();
    Clipboard.setString(text);
    toast().success('Message copied');
  }, []);

  // Copy the entire conversation (each turn's reasoning + answer) as plain text.
  const copyFullChat = useCallback(() => {
    const transcript = messages
      .map((m) => {
        const who = m.isUser ? 'You' : 'Agent';
        const body = m.isUser ? (m.text?.trim() ?? '') : buildCopyText(m);
        return body ? `${who}:\n${body}` : '';
      })
      .filter(Boolean)
      .join('\n\n———\n\n');
    if (!transcript) return;
    Clipboard.setString(transcript);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    toast().success('Full chat copied');
  }, [messages]);

  // ---- Contacts ----
  const handleContactSelection = (contact: Contact) => {
    if (!contact.lightning_address) {
      Alert.alert('No Lightning Address', "This contact doesn't have a Lightning address set up.");
      return;
    }
    setShowContactsSelector(false);
    setTimeout(() => {
      sendMessage(`Pay to ${contact.name} (${contact.lightning_address})`);
    }, 400);
  };

  // ---- Payments (human-in-the-loop gate for the agentic loop) ----
  // The engine pauses on money tools until the shared sheet resolves; the
  // approved tool then runs inside the agentic loop and the sheet shows
  // "Processing" until its result arrives.
  const confirm = useAiConfirm({ thresholdSats: mindConfig.confirmAuthThresholdSats });

  // ---- Send ----
  const sendMessage = async (text: string) => {
    const raw = (text || inputText).trim();
    if (!raw) return;

    // `/skill-name ...` — pin a skill for this message (Claude-style). A leading
    // slash command matching a skill sets it as the active skill; the rest is the
    // actual message. `/skill` alone just pins it and waits for the next message.
    let messageText = raw;
    let pinned: Skill | null = activeSkill;
    const slash = raw.match(/^\/(\S+)\s*([\s\S]*)$/);
    if (slash) {
      const token = slash[1].toLowerCase();
      const match = skills.find(
        (s) => s.name.toLowerCase() === token || skillSlug(s.name) === token,
      );
      if (match) {
        pinned = match;
        setActiveSkill(match);
        messageText = slash[2].trim();
        if (!messageText) {
          // Just pinned the skill — keep it active and let the user type next.
          setInputText('');
          Haptics.selectionAsync();
          return;
        }
      }
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setInputText('');
    setPartialText('');
    setShowActions(false);

    // The funnel routes by keyword/trigger; prepend the pinned skill's triggers so
    // it wins selection and the model receives that skill's instructions.
    const agentInput = pinned ? `${skillRouteHint(pinned)} ${messageText}`.trim() : messageText;

    addMessage({ id: nextId(), text: messageText, isUser: true, timestamp: new Date() });

    // Deterministic: a short "share" command opens the share sheet for the most
    // recent invoice — no model needed. Kept narrow so it can't swallow other
    // requests (e.g. "share my address").
    if (lastInvoiceRef.current && /^\s*(share( it| the invoice)?|condividi(lo|la)?|invia(la)?|send it)\s*[.!]*\s*$/i.test(messageText)) {
      const inv = lastInvoiceRef.current;
      try {
        const opened = await shareLightningInvoice(inv);
        addMessage({
          id: nextId(),
          text: opened ? '📤 Opened the share sheet for your invoice.' : '📋 Sharing isn’t available, so I copied the invoice to your clipboard.',
          isUser: false,
          timestamp: new Date(),
        });
      } catch {
        addMessage({ id: nextId(), text: 'Sorry, I couldn’t open the share sheet.', isUser: false, timestamp: new Date() });
      }
      return;
    }

    if (!qvac.isReady) {
      addMessage({
        id: nextId(),
        text:
          qvac.llmStatus === 'error'
            ? `⚠️ The on-device AI failed to load: ${qvac.error || 'unknown error'}. Tap retry in the banner above.`
            : `⏳ The on-device AI is still getting ready (${qvac.combinedProgress}%). Give it a moment and try again.`,
        isUser: false,
        timestamp: new Date(),
      });
      return;
    }

    setIsLoading(true);
    progressStep.current = null;
    setStep('Thinking on-device');

    const assistantId = nextId();
    addMessage({ id: assistantId, text: '', isUser: false, timestamp: new Date(), streaming: true });

    // Track which agentic turn is currently streaming so we show only the
    // latest turn's text — early reasoning turns are replaced by the final
    // answer once tools have run.
    let streamingTurn = 0;
    // This turn's reasoning, streamed into the bubble (revealed on tap).
    let thinkingText = '';
    let replyStarted = false;
    const approvals = new Map<string, boolean>();

    try {
      // Full prior conversation — the agent trims it to the configured
      // history length before prompting (small models overflow quickly).
      const history = messages
        .filter((m) => !m.streaming && m.text.trim().length > 0)
        .map((m) => ({ role: m.isUser ? 'user' : 'assistant', content: m.text })) as MindMessage[];

      // One shared funnel (fast-path → recipe → agentic) — see services/mindAgent.
      const res = await agent.runTurn(agentInput, {
        history,
        onStart: (requestId) => setActiveRequestId(requestId),
        onThinking: (tok) => {
          setStep('Reasoning');
          thinkingText += tok;
          updateMessage(assistantId, () => ({ thinking: thinkingText }));
        },
        // Real per-turn inference numbers (tok/s, tokens, GPU/CPU) — shown under
        // the reply and as a live chip in the header (desktop parity).
        onStats: (s) => {
          const st: ChatMsgStats = {
            tokensPerSecond: s.tokensPerSecond,
            totalTokens:
              s.totalTokens ??
              (s.generatedTokens != null && s.promptTokens != null ? s.promptTokens + s.generatedTokens : undefined),
            promptTokens: s.promptTokens,
            device: s.backendDevice,
          };
          updateMessage(assistantId, () => ({ stats: st }));
          setLastStats(st);
        },
        // A recipe step is executing (deterministic tier).
        onStep: (name) => setStep(stepForTool(name)),
        onToken: (token, turn) => {
          if (!replyStarted) {
            replyStarted = true;
            setReplyStreaming(true);
          }
          updateMessage(assistantId, (m) => {
            if (turn !== streamingTurn) {
              // New turn after a tool ran — reset to just this turn's tokens.
              streamingTurn = turn;
              return { text: token };
            }
            return { text: m.text + token };
          });
          scrollToBottom(true);
        },
        // Visible feedback while a tool runs (esp. during the payment gap).
        onToolCall: (call, info) => {
          if (replyStarted) {
            replyStarted = false;
            setReplyStreaming(false);
          }
          setStep(stepForTool(call.name, info.requiresConfirmation));
          updateMessage(assistantId, () => ({ text: '' }));
          scrollToBottom(true);
        },
        // Money tools pause here for explicit user approval.
        onConfirm: async (call) => {
          const decision = await confirm.request(call);
          approvals.set(call.name, decision.approved);
          return decision;
        },
        onToolResult: (event) => {
          confirm.onToolResult(event);
          if (approvals.get(event.name) !== false) {
            flashMood(toolResultFlash(event.result, approvals.get(event.name) === true));
          }
          setStep('Thinking');
        },
      });

      if (res.tier === 'fast') {
        // Instant deterministic read — attach the balance card when relevant.
        const card: ChatMessage['card'] | undefined =
          res.intent === 'balance'
            ? { type: 'balance', data: { ...(res.data as any), priceUsd: btcPriceUSD } }
            : undefined;
        updateMessage(assistantId, () => ({ text: res.text, card, streaming: false }));
      } else if (res.tier === 'recipe') {
        updateMessage(assistantId, () => ({ text: res.text, streaming: false }));
      } else {
        const lastCall = res.toolCalls?.[res.toolCalls.length - 1];
        const stopped = res.inference?.some((i) => i.status === 'cancelled');

        // If an invoice was just generated, remember it (so "share" can act on
        // it) and offer to share it if the model didn't already mention it.
        let finalText =
          res.text?.trim() ||
          (stopped
            ? 'Stopped.'
            : lastCall
            ? 'Done.'
            : "Sorry, I can't help with that just yet. Try rephrasing, or ask me about your balance, payments, or Bitcoin merchants.");
        const INVOICE_TOOLS = ['generate_invoice', 'spark_create_invoice', 'rln_create_ln_invoice', 'rln_create_rgb_invoice'];
        const invResult: any = INVOICE_TOOLS.includes(lastCall?.name ?? '') ? lastCall?.result : null;
        if (invResult?.invoice) {
          lastInvoiceRef.current = {
            invoice: invResult.invoice,
            amount: Number(invResult.amount_sats ?? invResult.amount) || 0,
            description: invResult.description,
          };
          if (!/share/i.test(finalText)) {
            finalText += '\n\nWant me to share it? Just say “share”.';
          }
        }

        updateMessage(assistantId, () => ({
          text: finalText,
          streaming: false,
          functionCalled: lastCall?.name,
          functionResult: lastCall?.result,
        }));
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('KaleidoMind chat error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      flashMood('concerned');
      // Wallet-tool errors are written for the user and shown as is; known engine
      // failures say what to do next; technical errors never reach the bubble.
      const msg = chatErrorMessage(error);
      updateMessage(assistantId, () => ({
        text: msg,
        streaming: false,
      }));
    }

    confirm.reset();
    setStep(null);
    setActiveRequestId(null);
    setReplyStreaming(false);
    setIsLoading(false);
  };

  const stopGeneration = useCallback(() => {
    if (activeRequestId) {
      qvac.service.cancelRequest(activeRequestId);
      setActiveRequestId(null);
    }
  }, [activeRequestId, qvac.service]);

  const formatRecordingDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // One-tap "new chat" — clears the conversation and resets per-chat state. No
  // confirm dialog (the desktop/Claude pattern: starting fresh is cheap & common).
  const newChat = useCallback(() => {
    setMessages([]);
    setLastStats(null);
    setShowHistory(false);
    lastInvoiceRef.current = null;
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const clearChatHistory = () => {
    Alert.alert('Clear chat', 'Clear this conversation? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: newChat },
    ]);
  };

  // ---- On-device model status banner ----
  const renderModelStatus = () => {
    // AI is opt-in (off by default) so the on-device worklet never auto-starts.
    if (!aiEnabled) {
      return (
        <View style={styles.modelBanner}>
          <View style={styles.modelBannerRow}>
            <Ionicons name="sparkles-outline" size={18} color={theme.colors.primary[600]} />
            <Text style={styles.modelBannerText}>
              Ask about your wallet or pay by voice. Turn on on-device AI to get started.
            </Text>
            <TouchableOpacity
              onPress={openMindSetup}
              style={styles.modelRetry}
              accessibilityLabel="Set up Agent"
            >
              <Text style={styles.modelRetryText}>Set up</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (qvac.isReady) return null;
    const isError = qvac.llmStatus === 'error';

    // Runtime can't run here (e.g. Simulator / no native worklet). Don't show a
    // scary failure.
    const isUnavailable = isError && (qvac.error ?? '').startsWith('unavailable:');
    if (isUnavailable) {
      return (
        <View style={[styles.modelBanner, styles.modelBannerError]}>
          <View style={styles.modelBannerRow}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.colors.warning[600]} />
            <Text style={styles.modelBannerText}>
              On-device AI isn’t available on this device, so KaleidoMind can’t run here.
            </Text>
            <TouchableOpacity
              onPress={() => dispatch(setAiMode('off'))}
              style={[styles.modelRetry, styles.modelRetryGhost]}
              accessibilityLabel="Turn off Agent"
            >
              <Text style={styles.modelRetryText}>Off</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const crashed = isError && (qvac.error ?? '').startsWith(WORKLET_CRASHED_PREFIX);
    const label = crashed
      ? 'On-device AI closed the app last time it started. Tap Retry to try again.'
      : isError
      ? 'On-device AI failed to load'
      : qvac.isDownloading
        ? `Downloading on-device AI… ${qvac.combinedProgress}%`
        : 'Loading on-device AI…';

    return (
      <View style={[styles.modelBanner, isError && styles.modelBannerError]}>
        <View style={styles.modelBannerRow}>
          {isError ? (
            <Ionicons name="alert-circle" size={18} color={theme.colors.error[600]} />
          ) : (
            <ActivityIndicator size="small" color={theme.colors.primary[600]} />
          )}
          <Text style={[styles.modelBannerText, isError && styles.modelBannerTextError]}>{label}</Text>
          {isError && (
            <TouchableOpacity onPress={qvac.initialize} style={styles.modelRetry} accessibilityLabel="Retry loading AI">
              <Text style={styles.modelRetryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
        {!isError && qvac.isDownloading && (
          <View style={styles.modelProgressTrack}>
            <View style={[styles.modelProgressFill, { width: `${qvac.combinedProgress}%` }]} />
          </View>
        )}
      </View>
    );
  };

  // ---- Collapsible quick-action strip (shown via the + button) ----
  const QUICK_ACTIONS: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    gradient: [string, string];
    onPress: () => void;
  }[] = [
    {
      icon: 'wallet',
      label: 'Balance',
      gradient: theme.colors.primary.gradient!,
      onPress: () => sendMessage("What's my balance?"),
    },
    {
      icon: 'receipt',
      label: 'Invoice',
      gradient: theme.colors.success.gradient!,
      onPress: () => setInputText('Generate an invoice for 1000 sats'),
    },
    {
      icon: 'people',
      label: 'Contacts',
      gradient: [theme.colors.brand.violet, theme.colors.protocol.arkade],
      onPress: () => setShowContactsSelector(true),
    },
    {
      icon: 'storefront',
      label: 'Merchants',
      gradient: theme.colors.warning.gradient!,
      onPress: () => sendMessage('Find Bitcoin-accepting merchants near me'),
    },
  ];

  const renderQuickActions = () => (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.quickActionsContainer}
        contentContainerStyle={styles.quickActionsContent}
        keyboardShouldPersistTaps="handled"
      >
        {QUICK_ACTIONS.map((a) => (
          <TouchableOpacity
            key={a.label}
            style={styles.quickActionButton}
            onPress={() => {
              setShowActions(false);
              a.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={a.label}
          >
            <LinearGradient colors={a.gradient} style={styles.quickActionGradient}>
              <Ionicons name={a.icon} size={16} color="white" />
              <Text style={styles.quickActionText}>{a.label}</Text>
            </LinearGradient>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Pin a skill for the next message (like a /command). */}
      {skills.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.skillRowContainer}
          contentContainerStyle={styles.quickActionsContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.skillRowLabel}>
            <Ionicons name="sparkles-outline" size={13} color={theme.colors.text.tertiary} />
            <Text style={styles.skillRowLabelText}>Skills</Text>
          </View>
          {skills.map((s) => {
            const on = activeSkill?.name === s.name;
            return (
              <TouchableOpacity
                key={s.name}
                style={[styles.skillChip, on && styles.skillChipActive]}
                onPress={() => {
                  setActiveSkill(on ? null : s);
                  setShowActions(false);
                  Haptics.selectionAsync();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use skill ${s.name}`}
              >
                <Text style={[styles.skillChipText, on && styles.skillChipTextActive]}>
                  /{skillSlug(s.name)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  const canSend = !!inputText.trim() && !isListening;

  return (
    <View style={styles.container}>
      <KaleidoMindOnboarding
        visible={mindOnboardingOpen}
        availability={mindAvailability}
        onSelectLocal={() => { dispatch(setAiMode('local')); finishMindSetup(); }}
        onSkip={() => { finishMindSetup(); }}
      />
      <VoiceAgentOverlay visible={voiceAgentOpen} autoListen={true} onClose={() => setVoiceAgentOpen(false)} />
      <MainHeader
        title="Agent"
        subtitle={aiEnabled ? headerSubtitle : 'On-device AI · off'}
        iconNode={<MindCharacterBadge size={22} color={theme.colors.text.primary} />}
        titleBadge={<Badge label="Experimental" color={theme.colors.warning[500]} size="sm" />}
        rightAction={
          // Two actions you use mid-chat (voice, new chat); the rest live in "More".
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {aiEnabled && (
              <TouchableOpacity style={styles.headerBtn} accessibilityRole="button"
                accessibilityLabel="Start a voice conversation" onPress={() => setVoiceAgentOpen(true)}>
                <Ionicons name="mic-outline" size={20} color={theme.colors.text.primary} />
              </TouchableOpacity>
            )}
            {aiEnabled && !isEmpty && (
              <TouchableOpacity style={styles.headerBtn} accessibilityRole="button" onPress={newChat} accessibilityLabel="New chat">
                <Ionicons name="create-outline" size={20} color={theme.colors.text.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.headerBtn} accessibilityRole="button" onPress={() => setShowMenu(true)} accessibilityLabel="More">
              <Ionicons name="ellipsis-horizontal" size={20} color={theme.colors.text.primary} />
            </TouchableOpacity>
          </View>
        }
      />
      <View style={styles.chatContainer}>
        <LinearGradient
          colors={[theme.colors.background.primary, theme.colors.background.primary]}
          style={styles.background}
        >
          {/* Hidden on-device voice input (QVAC Whisper) */}
          <VoiceInput
            ref={voiceInputRef}
            onStart={handleSpeechStart}
            onEnd={handleSpeechEnd}
            onResult={handleSpeechResult}
            onPartialResult={handlePartialResult}
            onError={handleSpeechError}
          />

          <KeyboardAvoidingView
            style={styles.content}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? headerOffset : 0}
          >
            <View style={styles.contentInner}>
              {renderModelStatus()}

              {isEmpty ? (
                <>
                  <IntentBar
                    style={styles.intentBar}
                    onReview={(target) => (navigation.getParent?.() ?? navigation).navigate(target.screen, target.params)}
                  />
                  {aiEnabled && <AgentWalletCard onPress={() => navigation.navigate('AgentWallet')} />}
                  <ChatEmptyState
                    onSuggestion={(q) => sendMessage(q)}
                    onContacts={() => setShowContactsSelector(true)}
                    hero={<MindCharacter mood={mood} size={112} paused={!isFocused} />}
                  />
                </>
              ) : (
                <ScrollView
                  ref={scrollViewRef}
                  style={styles.messagesContainer}
                  contentContainerStyle={styles.messagesContent}
                  showsVerticalScrollIndicator
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  scrollEventThrottle={16}
                  onContentSizeChange={() => scrollToBottom(true)}
                >
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      onCopy={copyToClipboard}
                      onOpenLink={openLink}
                      onLongPress={handleLongPressMessage}
                      statusLabel={message.streaming ? progressLabel : undefined}
                      characterMood={message.id === liveAssistantId ? mood : 'idle'}
                      animateCharacter={message.id === liveAssistantId && isFocused}
                      onSelectContact={(name) => {
                        setInputText(`Send to ${name} `);
                        Haptics.selectionAsync();
                      }}
                    />
                  ))}
                  {isLoading && !messages.some((m) => m.streaming) && (
                    <View style={styles.processingRow}>
                      <View style={styles.processingAvatar}>
                        <MindCharacter mood={mood} size={32} paused={!isFocused} />
                      </View>
                      <View style={styles.processingBubble}>
                        <TypingDots label={progressLabel ?? 'Thinking on-device…'} />
                      </View>
                    </View>
                  )}
                </ScrollView>
              )}

              <View style={styles.inputContainer}>
                <BlurView intensity={80} tint={theme.dark ? 'dark' : 'light'} style={styles.inputGradient}>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose model and voice" onPress={() => setShowSettings(true)} style={{flexDirection:'row',alignItems:'center',gap:theme.spacing[2],minHeight:32,paddingBottom:theme.spacing[2]}}>
                    <Ionicons name="hardware-chip-outline" size={14} color={theme.colors.text.secondary}/>
                    <Text style={{color:theme.colors.text.secondary,fontSize:theme.typography.fontSize.xs,flexShrink:1}} numberOfLines={1}>{headerSubtitle}</Text>
                    <Ionicons name="chevron-down" size={13} color={theme.colors.text.secondary}/>
                  </TouchableOpacity>
                  {showActions && renderQuickActions()}

                  {/* Pinned-skill chip: this message routes to it; tap ✕ to clear. */}
                  {activeSkill && (
                    <View style={styles.activeSkillRow}>
                      <View style={styles.activeSkillChip}>
                        <Ionicons name="sparkles" size={12} color={theme.colors.primary[500]} />
                        <Text style={styles.activeSkillText}>/{skillSlug(activeSkill.name)}</Text>
                        <TouchableOpacity onPress={() => setActiveSkill(null)} hitSlop={8} accessibilityLabel="Clear skill">
                          <Ionicons name="close" size={14} color={theme.colors.text.secondary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <View style={styles.inputRow}>
                    {/* Toggle quick actions */}
                    <TouchableOpacity
                      style={[styles.plusButton, showActions && styles.plusButtonActive]}
                      onPress={() => setShowActions((v) => !v)}
                      accessibilityLabel={showActions ? 'Hide quick actions' : 'Show quick actions'}
                    >
                      <Ionicons
                        name={showActions ? 'close' : 'add'}
                        size={22}
                        color={theme.colors.primary[600]}
                      />
                    </TouchableOpacity>

                    <View style={styles.textInputContainer}>
                      <TextInput
                        style={styles.textInput}
                        value={inputText}
                        onChangeText={(text) => {
                          setInputText(text);
                          if (!isListening) setBaseInputText(text);
                        }}
                        placeholder={isListening ? 'Listening… speak now' : 'Ask Agent…'}
                        placeholderTextColor={theme.colors.text.tertiary}
                        multiline
                        maxLength={500}
                        returnKeyType="send"
                        onSubmitEditing={() => {
                          if (inputText.trim()) {
                            sendMessage(inputText.trim());
                            Keyboard.dismiss();
                          }
                        }}
                        blurOnSubmit
                        editable={!isListening}
                      />

                      {isListening && partialText && (
                        <View style={styles.partialTextContainer}>
                          <Text style={styles.partialText}>"{partialText}"</Text>
                        </View>
                      )}

                      {inputText.length > 400 && (
                        <Text style={styles.charCount}>{inputText.length}/500</Text>
                      )}
                    </View>

                    {/* One trailing action button (standard chat pattern): STOP
                        while generating, SEND when there's text, otherwise MIC —
                        instead of a cluttered blue-mic + red-stop pair. */}
                    {isLoading ? (
                      <TouchableOpacity
                        style={styles.roundButton}
                        onPress={stopGeneration}
                        accessibilityLabel="Stop generating"
                      >
                        <LinearGradient colors={theme.colors.error.gradient!} style={styles.buttonGradient}>
                          <Ionicons name="stop" size={20} color="white" />
                        </LinearGradient>
                      </TouchableOpacity>
                    ) : canSend ? (
                      <TouchableOpacity
                        style={styles.roundButton}
                        onPress={() => sendMessage(inputText)}
                        accessibilityLabel="Send message"
                      >
                        <LinearGradient colors={theme.colors.primary.gradient!} style={styles.buttonGradient}>
                          <Ionicons name="arrow-up" size={20} color={theme.colors.text.inverse} />
                        </LinearGradient>
                      </TouchableOpacity>
                    ) : (
                      <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                        <TouchableOpacity
                          style={[styles.roundButton, (!isVoiceAvailable || !qvac.isReady) && styles.disabledButton]}
                          onPress={startListening}
                          disabled={!isVoiceAvailable || !qvac.isReady}
                          accessibilityLabel={isListening ? 'Stop recording' : 'Start voice input'}
                        >
                          <LinearGradient
                            colors={isListening ? theme.colors.error.gradient! : theme.colors.primary.gradient!}
                            style={styles.buttonGradient}
                          >
                            <Ionicons name={isListening ? 'stop' : 'mic'} size={20} color={theme.colors.text.inverse} />
                          </LinearGradient>
                        </TouchableOpacity>
                      </Animated.View>
                    )}
                  </View>

                  {isListening && (
                    <Animated.View
                      pointerEvents="box-none"
                      style={[
                        styles.recordingIndicator,
                        { opacity: pulseAnim.interpolate({ inputRange: [1, 1.3], outputRange: [0.85, 1] }) },
                      ]}
                    >
                      <View style={styles.recordingPill}>
                        <View style={styles.recordingDot} />
                        <Text style={styles.recordingText}>
                          Listening… {formatRecordingDuration(recordingDuration)}
                        </Text>
                        <TouchableOpacity style={styles.stopRecordingButton} onPress={stopListening} hitSlop={8}>
                          <Text style={styles.stopRecordingText}>Stop</Text>
                        </TouchableOpacity>
                      </View>
                    </Animated.View>
                  )}
                </BlurView>
              </View>
            </View>
          </KeyboardAvoidingView>

          {/* Payment Confirmation Modal */}
          <PaymentConfirmationModal
            visible={!!confirm.state}
            readback={confirm.state?.readback}
            onConfirm={confirm.approve}
            onCancel={confirm.cancel}
            loading={!!confirm.state?.loading}
            busyLabel={confirm.state?.busyLabel}
            requireAuth={confirm.state?.requireAuth}
            priceUsd={btcPriceUSD}
          />

          {/* Nostr Contacts Selector */}
          <NostrContactsSelector
            visible={showContactsSelector}
            onSelectContact={handleContactSelection}
            onClose={() => setShowContactsSelector(false)}
          />

          <Sheet visible={showMenu} onClose={() => setShowMenu(false)} title="Agent">
            {([
              ...(aiEnabled ? [{ icon: 'time-outline', label: 'Chat history', onPress: () => setShowHistory(true) }] : []),
              ...(aiEnabled && !isEmpty ? [{ icon: 'copy-outline', label: 'Copy this chat', onPress: copyFullChat }] : []),
              { icon: 'wallet-outline', label: 'Agent wallet', onPress: () => navigation.navigate('AgentWallet') },
              { icon: 'settings-outline', label: 'Models & settings', onPress: () => setShowSettings(true) },
            ] as { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[]).map((item) => (
              <TouchableOpacity key={item.label} style={styles.menuRow} accessibilityRole="button"
                onPress={() => { setShowMenu(false); item.onPress(); }}>
                <Ionicons name={item.icon} size={20} color={theme.colors.text.secondary} />
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.text.tertiary} />
              </TouchableOpacity>
            ))}
          </Sheet>

          {/* AI settings: model selection */}
          <QVACSettingsSheet
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            catalog={qvac.catalog}
            config={qvac.config}
            llmStatus={qvac.llmStatus}
            combinedProgress={qvac.combinedProgress}
            onSelectModel={(id) => qvac.setModel(id)}
            onDesignAgent={() => { setShowSettings(false); navigation.navigate('MindSettings'); }}
            deviceMemGb={qvac.deviceMemGb}
            recommendedModelId={qvac.recommendedModelId}
            aiMode={aiMode}
            onSetAiMode={(mode) => dispatch(setAiMode(mode))}
            downloadedModelIds={qvac.downloadedModelIds}
            onDeleteModel={(id) => qvac.deleteModel(id)}
            sttCatalog={qvac.sttCatalog}
            ttsOptions={qvac.ttsOptions}
            onSetSttModel={(id) => qvac.setSttModel(id)}
            onSetTtsEngine={(engine) => qvac.setTtsEngine(engine)}
          />

          {/* Conversation history — current chat (desktop parity) + new/clear. */}
          <Modal visible={showHistory} transparent animationType="slide" onRequestClose={() => setShowHistory(false)}>
            <Pressable style={styles.skillsBackdrop} onPress={() => setShowHistory(false)}>
              <Pressable style={styles.skillsSheet} onPress={() => {}}>
                <View style={styles.skillsHandle} />
                <View style={styles.historyHeaderRow}>
                  <Text style={styles.skillsTitle}>Conversation</Text>
                  <View style={styles.historyActions}>
                    <TouchableOpacity style={styles.historyAction} onPress={newChat} accessibilityLabel="New chat">
                      <Ionicons name="create-outline" size={15} color={theme.colors.primary[500]} />
                      <Text style={styles.historyActionText}>New</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.historyAction}
                      onPress={() => { newChat(); }}
                      accessibilityLabel="Clear conversation"
                      disabled={isEmpty}
                    >
                      <Ionicons name="trash-outline" size={15} color={isEmpty ? theme.colors.text.tertiary : theme.colors.error[500]} />
                      <Text style={[styles.historyActionText, { color: isEmpty ? theme.colors.text.tertiary : theme.colors.error[500] }]}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.skillsHint}>{messages.length} message{messages.length === 1 ? '' : 's'} in this chat.</Text>
                {isEmpty ? (
                  <Text style={styles.skillsHint}>No messages yet — ask Agent anything.</Text>
                ) : (
                  <ScrollView style={styles.historyList} keyboardShouldPersistTaps="handled">
                    {messages.filter((m) => m.text?.trim()).map((m) => (
                      <View key={m.id} style={styles.historyItem}>
                        <Text style={styles.historyWho}>{m.isUser ? 'You' : 'Agent'}</Text>
                        <Text style={styles.historyPreview} numberOfLines={2}>{m.text.trim()}</Text>
                        <Text style={styles.historyTime}>
                          {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </LinearGradient>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background.primary },
    chatContainer: { flex: 1 },
    intentBar: { marginHorizontal: theme.spacing[4], marginTop: theme.spacing[3] },
    background: { flex: 1 },
    skillsBackdrop: { flex: 1, backgroundColor: theme.colors.background.backdrop, justifyContent: 'flex-end' },
    skillsSheet: { backgroundColor: theme.colors.background.primary, borderTopLeftRadius: theme.borderRadius.xl, borderTopRightRadius: theme.borderRadius.xl, padding: theme.spacing[5], paddingBottom: theme.spacing[9] },
    skillsHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border.medium, alignSelf: 'center', marginBottom: theme.spacing[3.5] },
    skillsTitle: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.lg, fontWeight: theme.typography.fontWeight.bold },
    skillsHint: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: theme.spacing[1], marginBottom: theme.spacing[3] },
    skillItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
    skillItemIcon: { width: 34, height: 34, borderRadius: theme.borderRadius.base, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary[500] + '1A' },
    skillItemName: { color: theme.colors.text.primary, fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold, textTransform: 'capitalize' },
    skillItemDesc: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, marginTop: 2, lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.tight) },
    historyHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    historyActions: { flexDirection: 'row', gap: theme.spacing[3] },
    historyAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    historyActionText: { color: theme.colors.primary[500], fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold },
    historyList: { maxHeight: 360, marginTop: theme.spacing[2] },
    historyItem: { paddingVertical: theme.spacing[2.5], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.light },
    historyWho: { color: theme.colors.text.tertiary, fontSize: theme.typography.fontSize.xs, fontWeight: theme.typography.fontWeight.bold, marginBottom: 2 },
    historyPreview: { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.snug) },
    historyTime: { color: theme.colors.text.tertiary, fontSize: 11, marginTop: 3 },
    content: { flex: 1 },
    contentInner: { flex: 1 },
    messagesContainer: { flex: 1 },
    messagesContent: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[4],
      paddingBottom: theme.spacing[6],
    },

    // Processing row (no active streaming bubble yet)
    processingRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: theme.spacing[4] },
    processingAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: theme.spacing[3],
    },
    processingBubble: {
      backgroundColor: theme.colors.surface.primary,
      paddingVertical: theme.spacing[3],
      paddingHorizontal: theme.spacing[4],
      borderRadius: theme.borderRadius.xl,
      ...theme.shadows.md,
    },

    // Quick actions
    quickActionsContainer: { marginBottom: theme.spacing[3] },
    quickActionsContent: { paddingHorizontal: theme.spacing[1], gap: theme.spacing[2] },
    quickActionButton: { borderRadius: theme.borderRadius.lg, overflow: 'hidden', ...theme.shadows.sm },
    quickActionGradient: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      gap: theme.spacing[2],
    },
    quickActionText: { fontSize: theme.typography.fontSize.xs, color: 'white', fontWeight: '600', letterSpacing: 0.5 },
    skillRowContainer: { marginBottom: theme.spacing[3] },
    skillRowLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: theme.spacing[1], alignSelf: 'center' },
    skillRowLabelText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, fontWeight: '600' },
    skillChip: {
      paddingVertical: theme.spacing[1.5] ?? 6,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.full ?? 999,
      backgroundColor: theme.colors.surface.secondary,
      borderWidth: 1,
      borderColor: theme.colors.border.light,
    },
    skillChipActive: { backgroundColor: `${theme.colors.primary[500]}22`, borderColor: theme.colors.primary[500] },
    skillChipText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, fontWeight: '600' },
    skillChipTextActive: { color: theme.colors.primary[500] },
    activeSkillRow: { flexDirection: 'row', marginBottom: theme.spacing[2], paddingHorizontal: theme.spacing[1] },
    activeSkillChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: theme.borderRadius.full ?? 999,
      backgroundColor: `${theme.colors.primary[500]}1A`,
      borderWidth: 1,
      borderColor: `${theme.colors.primary[500]}55`,
    },
    activeSkillText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.primary[500], fontWeight: '700' },

    // Input
    inputContainer: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.light,
      backgroundColor: 'transparent',
    },
    inputGradient: {
      padding: theme.spacing[3],
    },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
    plusButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surface.primary,
      borderWidth: 1,
      borderColor: theme.colors.border.light,
    },
    plusButtonActive: { backgroundColor: theme.colors.surface.highlight, borderColor: theme.colors.primary[400] ?? theme.colors.primary[500] },
    textInputContainer: {
      flex: 1,
      backgroundColor: theme.colors.surface.primary,
      borderRadius: theme.borderRadius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border.light,
      ...theme.shadows.sm,
      maxHeight: 120,
    },
    textInput: {
      paddingHorizontal: theme.spacing[4],
      paddingVertical: theme.spacing[2],
      fontSize: theme.typography.fontSize.base,
      maxHeight: 90,
      minHeight: 40,
      color: theme.colors.text.primary,
      lineHeight: 20,
    },
    partialTextContainer: {
      paddingHorizontal: theme.spacing[4],
      paddingBottom: theme.spacing[2],
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.light,
      backgroundColor: theme.colors.surface.highlight,
    },
    partialText: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.primary[600],
      fontStyle: 'italic',
    },
    charCount: {
      alignSelf: 'flex-end',
      paddingRight: theme.spacing[3],
      paddingBottom: theme.spacing[1],
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.text.tertiary,
    },
    roundButton: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
    buttonGradient: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
    disabledButton: { opacity: 0.5 },

    // Recording
    // Floats ABOVE the input bar (absolute) so toggling voice never reflows the
    // input row / buttons. A single compact pill instead of a stacked block.
    recordingIndicator: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: -2,
      alignItems: 'center',
      transform: [{ translateY: -44 }],
    },
    recordingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      backgroundColor: theme.colors.error[50] ?? 'rgba(255,107,107,0.12)',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.error[100] ?? 'rgba(255,107,107,0.25)',
      ...theme.shadows.sm,
    },
    recordingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.error[500],
    },
    recordingText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.error[600], fontWeight: '600' },
    stopRecordingButton: {
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      backgroundColor: theme.colors.error[100] ?? 'rgba(255,107,107,0.2)',
      borderRadius: theme.borderRadius.md,
    },
    stopRecordingText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.error[600], fontWeight: '700' },

    // Header buttons
    headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface.secondary, borderRadius: 18 },
    menuRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 52, paddingHorizontal: theme.spacing[1] },
    menuLabel: { flex: 1, fontSize: theme.typography.fontSize.base, fontWeight: '500', color: theme.colors.text.primary },
    headerBtnDanger: { backgroundColor: 'rgba(255,59,48,0.85)' },

    // Model status banner
    modelBanner: {
      marginHorizontal: theme.spacing[4],
      marginTop: theme.spacing[3],
      padding: theme.spacing[3],
      backgroundColor: theme.colors.surface.highlight,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.primary[100] ?? theme.colors.border.light,
    },
    modelBannerError: {
      backgroundColor: theme.colors.error[50] ?? theme.colors.surface.secondary,
      borderColor: theme.colors.error[100] ?? theme.colors.border.light,
    },
    modelBannerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
    modelBannerText: {
      flex: 1,
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.primary[700] ?? theme.colors.primary[600],
      fontWeight: '600',
    },
    modelBannerTextError: { color: theme.colors.error[700] ?? theme.colors.error[600] },
    modelRetry: {
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[3],
      backgroundColor: theme.colors.error[600],
      borderRadius: theme.borderRadius.sm,
    },
    modelRetryGhost: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: theme.colors.border.medium,
      marginRight: theme.spacing[2],
    },
    modelRetryText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.inverse, fontWeight: '700' },
    modelProgressTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.primary[100] ?? theme.colors.border.light,
      marginTop: theme.spacing[2],
      overflow: 'hidden',
    },
    modelProgressFill: { height: '100%', borderRadius: 2, backgroundColor: theme.colors.primary[500] },
  });
