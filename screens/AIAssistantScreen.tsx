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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { selectAiEnabled, setAiEnabled, setAiMode } from '../store/slices/settingsSlice';
import { useAppTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme';
import { MainHeader } from '../components';
import { ChatEmptyState, MessageBubble, TypingDots } from '../components/chat';
import type { ChatMessage } from '../components/chat';
import VoiceInput, { VoiceInputRef } from '../components/VoiceInput';
import PaymentConfirmationModal from '../components/PaymentConfirmationModal';
import NostrContactsSelector from '../components/NostrContactsSelector';
import QVACSettingsSheet from '../components/QVACSettingsSheet';
import ToastService from '../services/ToastService';
import { AIAssistantFunctions } from '../services/aiAssistantFunctions';
import { createQVACTools } from '../services/qvacTools';
import { useQVAC } from '../hooks/useQVAC';
import { getModelById } from '../services/qvacModels';
import { PairingService } from '../services/PairingService';
import {
  Engine,
  ToolRegistry,
  InProcessToolSource,
  createL402ToolSource,
  SkillRegistry,
  skillsFromBundle,
  type LLMProvider,
  type InProcessTool,
  type SkillBundle,
  type Message as MindMessage,
} from '@kaleidorg/mind';
import { protocolManager } from '../services/protocols';
// Skills authored as SKILL.md under ./skills, bundled to JSON at build time
// (`npm run bundle-skills`). Same authoring + loader the desktop uses.
import skillBundle from '../skills.bundle.json';
import * as Haptics from 'expo-haptics';

interface Props {
  navigation: any;
}

interface PaymentDetails {
  type: 'lightning_address' | 'lightning_invoice' | 'nostr_contact';
  recipient: string;
  amount: number;
  description?: string;
  recipientName?: string;
  recipientAvatar?: string;
  lightningAddress?: string;
  isNostrContact?: boolean;
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

const SYSTEM_PROMPT = {
  role: 'system',
  content:
    'You are KaleidoSwap, a concise, privacy-first assistant running fully on-device inside a non-custodial Bitcoin, Lightning and RGB wallet. ' +
    'Use the provided tools to take actions: pay invoices/addresses, generate invoices, check balance, get a receive address, list recent transactions, find Lugano merchants, or pay Nostr contacts. ' +
    'Never invent balances, addresses or transaction data — always call the relevant tool and report what it returns. All BTC amounts are in satoshis. ' +
    'Keep replies short and friendly.',
};

const toast = () => ToastService.getInstance();

export default function AIAssistantScreen({ navigation }: Props) {
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

  // Payment confirmation state
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PaymentDetails | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Nostr contacts state
  const [showContactsSelector, setShowContactsSelector] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const voiceInputRef = useRef<VoiceInputRef>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);

  // On-device QVAC: model lifecycle + wallet tools.
  // Only auto-start the Bare worklet when the user has explicitly enabled AI
  // (off by default) — starting it on a native/JS mismatch hard-crashes the app.
  const aiEnabled = useSelector(selectAiEnabled);
  const dispatch = useDispatch();
  const qvac = useQVAC(aiEnabled);
  const aiFunctions = useMemo(() => new AIAssistantFunctions(), []);
  const tools = useMemo(() => createQVACTools(aiFunctions), [aiFunctions]);

  // Shared @kaleido/mind engine: same agentic loop on mobile, desktop and agent.
  // Provider = QVAC (local or P2P-delegated); tool source = the on-device wallet
  // tools (handlers run here, so signing never leaves the phone). The QVACService
  // singleton is stable, and `tools` only changes when aiFunctions does, so the
  // engine identity is stable across renders.
  const engine = useMemo(() => {
    const provider: LLMProvider = {
      name: 'qvac',
      runTurn: (input) => qvac.service.runProviderTurn(input),
      cancel: (id) => qvac.service.cancelRequest(id),
    };
    const walletSource = new InProcessToolSource('wallet', tools as unknown as InProcessTool[]);

    // Shared wallet payment path — used by every "agent spends sats" source
    // (L402, Bitrefill, …). Pays a BOLT11 with the on-device Lightning wallet
    // (Spark preferred, RLN fallback) so keys never leave the device.
    const payInvoice = async (invoice: string) => {
      const spark = protocolManager.getAdapterIfAvailable('SPARK');
      const rln = protocolManager.getAdapterIfAvailable('RGB');
      const adapter: any = spark?.isConnected() ? spark : rln?.isConnected() ? rln : null;
      if (!adapter) throw new Error('No Lightning wallet connected to pay the invoice');
      const r: any = await adapter.sendPayment({ invoice });
      return { preimage: r?.preimage ?? r?.paymentPreimage ?? r?.payment_preimage ?? '' };
    };

    // L402: buy paywalled HTTP resources in sats. The invoice amount is only
    // known during the 402 challenge, so rather than a broken pre-execution
    // payment modal we auto-pay small amounts (≤ cap). Larger ones are declined.
    const l402Source = createL402ToolSource({
      payInvoice,
      maxAutoPaySats: 1000,
      requiresConfirmation: false,
      log: (m: string) => console.log('[L402]', m),
    });

    return new Engine({
      provider,
      tools: new ToolRegistry([walletSource, l402Source]),
      defaultMaxTurns: 5,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, qvac.service]);

  // Skills route a query to a focused playbook + a curated tool subset
  // (progressive disclosure — the small mobile model never sees every tool at
  // once). No match → the full toolset is used. Authored as SKILL.md under
  // ./skills and bundled to skills.bundle.json; add a skill by dropping a new
  // folder there and re-running `npm run bundle-skills`.
  const skills = useMemo(
    () => new SkillRegistry(skillsFromBundle(skillBundle as SkillBundle)),
    [],
  );

  // Raw tool call awaiting user confirmation (e.g. a payment)
  const [pendingToolCall, setPendingToolCall] = useState<{ name: string; arguments: any } | null>(null);

  // requestId of the in-flight completion, used to cancel via the stop button
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // AI settings sheet (model selection + P2P delegation)
  const [showSettings, setShowSettings] = useState(false);

  // Friendly name of the paired desktop (for the settings chip + header).
  const [providerName, setProviderName] = useState<string | null>(null);

  const isEmpty = messages.length === 0;

  // Re-read delegation config + paired-desktop name whenever this screen
  // regains focus (e.g. after returning from the QR scanner). reloadConfig is
  // held in a ref so the effect can depend ONLY on `navigation`.
  const reloadConfigRef = useRef(qvac.reloadConfig);
  reloadConfigRef.current = qvac.reloadConfig;

  useEffect(() => {
    const refresh = async () => {
      reloadConfigRef.current();
      try {
        const active = await PairingService.getActive();
        setProviderName(active?.name ?? null);
      } catch {
        setProviderName(null);
      }
    };
    refresh();
    const unsub = navigation.addListener?.('focus', refresh);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [navigation]);

  // Open the QR scanner to pair with a desktop, closing the settings sheet first.
  const openScanner = useCallback(() => {
    setShowSettings(false);
    navigation.navigate('PairDesktop');
  }, [navigation]);

  // Header subtitle: which model + whether we're delegating to a desktop.
  const headerSubtitle = useMemo(() => {
    const delegating = qvac.config.delegateEnabled && !!qvac.config.providerPublicKey;
    const modelLabel = getModelById(qvac.config.modelId)?.label ?? 'On-device AI';
    if (delegating) {
      return `${modelLabel} · via ${providerName || 'Desktop'}`;
    }
    return `${modelLabel} · on this device`;
  }, [qvac.config.delegateEnabled, qvac.config.providerPublicKey, qvac.config.modelId, providerName]);

  const nostrState = useSelector((state: RootState) => state.nostr);

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

  // ---- Shared feedback helpers (non-blocking toasts) ----
  const copyToClipboard = useCallback((text: string, label: string = 'Text') => {
    if (!text) return;
    Clipboard.setString(text);
    toast().success(`${label} copied to clipboard`);
  }, []);

  const openLink = useCallback((url: string) => {
    Linking.openURL(url).catch(() => toast().error('Could not open link'));
  }, []);

  const handleLongPressMessage = useCallback((message: ChatMessage) => {
    if (!message.text?.trim()) return;
    Haptics.selectionAsync();
    Clipboard.setString(message.text);
    toast().success('Message copied');
  }, []);

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
  // The @kaleido/mind engine pauses on money tools and awaits this resolver.
  // The modal's Confirm/Cancel buttons resolve it; the payment then runs inside
  // the engine's agentic loop (via the wallet ToolSource) so the model can
  // summarise the result.
  const confirmResolver = useRef<((d: { approved: boolean; reason?: string }) => void) | null>(null);

  const cancelPayment = () => {
    setShowPaymentConfirmation(false);
    setPendingPayment(null);
    setPendingToolCall(null);
    confirmResolver.current?.({ approved: false, reason: 'cancelled by user' });
    confirmResolver.current = null;
  };

  const buildPaymentDetails = (call: { name: string; arguments: any }): PaymentDetails => {
    const args = call.arguments || {};
    if (call.name === 'pay_nostr_contact') {
      return {
        type: 'nostr_contact',
        recipient: args.contact_name || args.contact_npub || 'Nostr contact',
        amount: Number(args.amount_sats) || 0,
        description: args.description || 'Payment to Nostr contact',
        recipientName: args.contact_name,
        isNostrContact: true,
      };
    }
    const target = String(args.invoice_or_address || '');
    const isAddress = target.includes('@');
    return {
      type: isAddress ? 'lightning_address' : 'lightning_invoice',
      recipient: target,
      amount: Number(args.amount_sats) || 0,
      description: args.description || 'Payment via AI Assistant',
      lightningAddress: isAddress ? target : undefined,
    };
  };

  // Opens the confirmation modal and returns a promise the agentic loop awaits.
  const requestConfirmation = (call: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ approved: boolean; reason?: string }> =>
    new Promise((resolve) => {
      confirmResolver.current = resolve;
      setPendingToolCall({ name: call.name, arguments: call.arguments });
      setPendingPayment(buildPaymentDetails(call));
      setShowPaymentConfirmation(true);
    });

  // Approve only — the payment itself executes inside the engine's agentic loop
  // (via the wallet ToolSource), after which the model summarises the outcome.
  const handlePaymentConfirm = () => {
    setShowPaymentConfirmation(false);
    setPaymentLoading(false);
    confirmResolver.current?.({ approved: true });
    confirmResolver.current = null;
  };

  // ---- Send ----
  const sendMessage = async (text: string) => {
    const messageText = (text || inputText).trim();
    if (!messageText) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setInputText('');
    setPartialText('');
    setShowActions(false);

    addMessage({ id: nextId(), text: messageText, isUser: true, timestamp: new Date() });

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

    const assistantId = nextId();
    addMessage({ id: assistantId, text: '', isUser: false, timestamp: new Date(), streaming: true });

    // Track which agentic turn is currently streaming so we show only the
    // latest turn's text — early reasoning turns are replaced by the final
    // answer once tools have run.
    let streamingTurn = 0;

    try {
      const history = messages
        .filter((m) => !m.streaming)
        .map((m) => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));

      // Enter the most relevant skill: compose its playbook into the system
      // prompt and expose only its tools (progressive disclosure). No match →
      // the base prompt + full toolset.
      const skill = skills.select(messageText);
      const { system: skillSystem, allowedTools } = skills.compose(
        String(SYSTEM_PROMPT.content),
        skill,
      );
      const chatMessages = [
        { role: 'system', content: skillSystem },
        ...history,
        { role: 'user', content: messageText },
      ];

      const res = await engine.runAgentic(chatMessages as MindMessage[], {
        allowedTools,
        onStart: (requestId) => setActiveRequestId(requestId),
        onToken: (token, turn) => {
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
        onToolCall: (call) => {
          const def = tools.find((t) => t.name === call.name);
          // Visible feedback while a tool runs (esp. during the payment gap).
          updateMessage(assistantId, () => ({
            text: def?.requiresConfirmation
              ? '⚡ Preparing payment…'
              : `🔧 ${call.name.replace(/_/g, ' ')}…`,
          }));
          scrollToBottom(true);
        },
        // Money tools pause here for explicit user approval.
        onConfirm: requestConfirmation,
      });

      const lastCall = res.toolCalls[res.toolCalls.length - 1];
      updateMessage(assistantId, () => ({
        text: res.text?.trim() || 'Done.',
        streaming: false,
        functionCalled: lastCall?.name,
        functionResult: lastCall?.result,
      }));

      // Clear any lingering confirmation UI.
      setPendingPayment(null);
      setPendingToolCall(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      console.error('QVAC chat error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      updateMessage(assistantId, () => ({
        text: "I couldn't process that on-device just now. Please try again. 🔧",
        streaming: false,
      }));
    }

    setActiveRequestId(null);
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

  const clearChatHistory = () => {
    Alert.alert('Clear Chat History', 'Are you sure you want to clear all chat history? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => setMessages([]),
      },
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
              KaleidoMind (on-device AI) is off. Enable to download and run it locally.
            </Text>
            <TouchableOpacity
              onPress={() => dispatch(setAiEnabled(true))}
              style={styles.modelRetry}
              accessibilityLabel="Enable on-device AI"
            >
              <Text style={styles.modelRetryText}>Enable</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (qvac.isReady) return null;
    const isError = qvac.llmStatus === 'error';

    // Runtime can't run here (e.g. Simulator / no native worklet). Don't show a
    // scary failure — offer to delegate to a desktop instead.
    const isUnavailable = isError && (qvac.error ?? '').startsWith('unavailable:');
    if (isUnavailable) {
      return (
        <View style={[styles.modelBanner, styles.modelBannerError]}>
          <View style={styles.modelBannerRow}>
            <Ionicons name="desktop-outline" size={18} color={theme.colors.warning[600]} />
            <Text style={styles.modelBannerText}>
              On-device AI isn’t available on this device. Connect a desktop to run KaleidoMind.
            </Text>
            <TouchableOpacity
              onPress={() => {
                dispatch(setAiMode('delegate'));
                navigation.navigate('PairDesktop');
              }}
              style={styles.modelRetry}
              accessibilityLabel="Connect a desktop"
            >
              <Text style={styles.modelRetryText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const label = isError
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
      gradient: ['#8B5CF6', '#A855F7'],
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
  );

  const canSend = !!inputText.trim() && !isListening;

  return (
    <View style={styles.container}>
      <MainHeader
        title="KaleidoMind"
        subtitle={aiEnabled ? headerSubtitle : 'On-device AI · off'}
        icon="sparkles"
        rightAction={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {nostrState.isConnected && (
              <View style={styles.nostrIndicator}>
                <Ionicons name="checkmark-circle" size={16} color={theme.colors.success[500]} />
              </View>
            )}
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => setShowSettings(true)}
              accessibilityLabel="AI settings"
            >
              <Ionicons name="settings-outline" size={20} color="white" />
            </TouchableOpacity>
            {!isEmpty && (
              <TouchableOpacity
                style={[styles.headerBtn, styles.headerBtnDanger]}
                onPress={clearChatHistory}
                accessibilityLabel="Clear chat history"
              >
                <Ionicons name="trash-outline" size={20} color="white" />
              </TouchableOpacity>
            )}
          </View>
        }
      />
      <View style={styles.chatContainer}>
        <LinearGradient
          colors={[theme.colors.background.primary, theme.colors.background.tertiary]}
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
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
          >
            <View style={styles.contentInner}>
              {renderModelStatus()}

              {isEmpty ? (
                <ChatEmptyState onSuggestion={(q) => sendMessage(q)} onContacts={() => setShowContactsSelector(true)} />
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
                    />
                  ))}
                  {isLoading && !messages.some((m) => m.streaming) && (
                    <View style={styles.processingRow}>
                      <LinearGradient colors={theme.colors.primary.gradient!} style={styles.processingAvatar}>
                        <Ionicons name="sparkles" size={16} color="#fff" />
                      </LinearGradient>
                      <View style={styles.processingBubble}>
                        <TypingDots label="Thinking on-device…" />
                      </View>
                    </View>
                  )}
                </ScrollView>
              )}

              <View style={styles.inputContainer}>
                <BlurView intensity={80} tint={theme.dark ? 'dark' : 'light'} style={styles.inputGradient}>
                  {showActions && renderQuickActions()}

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
                        placeholder={isListening ? 'Listening… speak now' : 'Ask about Bitcoin or payments'}
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

                    {/* Voice input button */}
                    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                      <TouchableOpacity
                        style={[styles.roundButton, (!isVoiceAvailable || !qvac.isReady) && styles.disabledButton]}
                        onPress={startListening}
                        disabled={!isVoiceAvailable || isLoading || !qvac.isReady}
                        accessibilityLabel={isListening ? 'Stop recording' : 'Start voice input'}
                      >
                        <LinearGradient
                          colors={isListening ? theme.colors.error.gradient! : theme.colors.accent.gradient!}
                          style={styles.buttonGradient}
                        >
                          <Ionicons name={isListening ? 'stop' : 'mic'} size={20} color="white" />
                        </LinearGradient>
                      </TouchableOpacity>
                    </Animated.View>

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
                    ) : (
                      <TouchableOpacity
                        style={[styles.roundButton, !canSend && styles.disabledButton]}
                        onPress={() => sendMessage(inputText)}
                        disabled={!canSend}
                        accessibilityLabel="Send message"
                      >
                        <LinearGradient
                          colors={canSend ? theme.colors.primary.gradient! : [theme.colors.gray[300], theme.colors.gray[300]]}
                          style={styles.buttonGradient}
                        >
                          <Ionicons name="send" size={20} color={canSend ? 'white' : theme.colors.gray[500]} />
                        </LinearGradient>
                      </TouchableOpacity>
                    )}
                  </View>

                  {isListening && (
                    <Animated.View
                      style={[
                        styles.recordingIndicator,
                        { opacity: pulseAnim.interpolate({ inputRange: [1, 1.3], outputRange: [0.8, 1] }) },
                      ]}
                    >
                      <View style={styles.recordingInfo}>
                        <View style={styles.recordingDot} />
                        <Text style={styles.recordingText}>
                          Listening… {formatRecordingDuration(recordingDuration)}
                        </Text>
                      </View>
                      <TouchableOpacity style={styles.stopRecordingButton} onPress={stopListening}>
                        <Text style={styles.stopRecordingText}>Tap to stop</Text>
                      </TouchableOpacity>
                    </Animated.View>
                  )}
                </BlurView>
              </View>
            </View>
          </KeyboardAvoidingView>

          {/* Payment Confirmation Modal */}
          <PaymentConfirmationModal
            visible={showPaymentConfirmation}
            paymentDetails={pendingPayment}
            onConfirm={handlePaymentConfirm}
            onCancel={cancelPayment}
            loading={paymentLoading}
          />

          {/* Nostr Contacts Selector */}
          <NostrContactsSelector
            visible={showContactsSelector}
            onSelectContact={handleContactSelection}
            onClose={() => setShowContactsSelector(false)}
          />

          {/* AI settings: model selection + P2P delegation */}
          <QVACSettingsSheet
            visible={showSettings}
            onClose={() => setShowSettings(false)}
            catalog={qvac.catalog}
            config={qvac.config}
            llmStatus={qvac.llmStatus}
            combinedProgress={qvac.combinedProgress}
            onSelectModel={(id) => qvac.setModel(id)}
            onSetDelegate={(opts) => qvac.setDelegate(opts)}
            onScanQR={openScanner}
            providerName={providerName}
            deviceMemGb={qvac.deviceMemGb}
            recommendedModelId={qvac.recommendedModelId}
            aiEnabled={aiEnabled}
            onSetAiEnabled={(enabled) => dispatch(setAiEnabled(enabled))}
          />
        </LinearGradient>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background.primary },
    chatContainer: { flex: 1 },
    background: { flex: 1 },
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

    // Input
    inputContainer: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.light,
      backgroundColor: 'transparent',
    },
    inputGradient: {
      padding: theme.spacing[3],
      paddingBottom: Platform.OS === 'ios' ? theme.spacing[5] : theme.spacing[3],
    },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing[2] },
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
    recordingIndicator: {
      marginTop: theme.spacing[3],
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      backgroundColor: theme.colors.error[50] ?? 'rgba(255,107,107,0.1)',
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.error[100] ?? 'rgba(255,107,107,0.2)',
    },
    recordingInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing[1],
    },
    recordingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.error[500],
      marginRight: theme.spacing[2],
    },
    recordingText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.error[600], fontWeight: '600' },
    stopRecordingButton: {
      alignSelf: 'center',
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      backgroundColor: theme.colors.error[100] ?? 'rgba(255,107,107,0.2)',
      borderRadius: theme.borderRadius.md,
    },
    stopRecordingText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.error[600], fontWeight: '600' },

    // Header buttons
    nostrIndicator: { padding: 4, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12 },
    headerBtn: { padding: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12 },
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
