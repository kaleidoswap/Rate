import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { speak as qvacSpeak, stopSpeak } from '../../services/qvacTts';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';
import { theme } from '../../theme';
import VoiceInput, { VoiceInputRef } from '../VoiceInput';
import { useQVAC } from '../../hooks/useQVAC';
import { createMindAgent } from '../../services/mindAgent';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';
interface Bubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The model's chain-of-thought for this turn (shown on demand). */
  thinking?: string;
}
interface ConfirmState {
  call: { name: string; arguments: Record<string, unknown> };
  resolve: (v: { approved: boolean; reason?: string }) => void;
}

let _id = 0;
const nextId = () => `${Date.now()}-${_id++}`;

interface VoiceAgentOverlayProps {
  visible: boolean;
  onClose: () => void;
  /** Start listening as soon as the on-device AI is ready (press-and-hold entry). */
  autoListen?: boolean;
}

/**
 * Wrapper: only mount the session (and its QVAC/audio init) once opened, so the
 * dashboard stays light and nothing audio-related runs until the user taps the mic.
 */
export const VoiceAgentOverlay: React.FC<VoiceAgentOverlayProps> = ({ visible, onClose, autoListen }) =>
  visible ? <VoiceAgentSession onClose={onClose} autoListen={autoListen} /> : null;

const VoiceAgentSession: React.FC<{ onClose: () => void; autoListen?: boolean }> = ({ onClose, autoListen }) => {
  const qvac = useQVAC();
  // Same KaleidoMind funnel as the chat screen — fast-path, recipes, contract
  // wallet tools, memory + on-device RAG, confirm gate.
  const agent = useMemo(() => createMindAgent(qvac.service), [qvac.service]);
  const voiceRef = useRef<VoiceInputRef>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which assistant bubbles have their reasoning expanded (tap to reveal).
  const [openThinking, setOpenThinking] = useState<Record<string, boolean>>({});

  // True while the session is mounted — guards the speak→listen loop so a late
  // TTS callback can't start the recorder after the overlay has closed.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);

  // Drive the orb animation from the current phase.
  useEffect(() => {
    cancelAnimation(pulse);
    cancelAnimation(spin);
    if (phase === 'listening') {
      pulse.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else if (phase === 'speaking') {
      pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else if (phase === 'thinking') {
      spin.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.linear }), -1, false);
    } else {
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [phase]);

  // Clean up audio when the session unmounts (i.e. the overlay is closed).
  useEffect(
    () => () => {
      void stopSpeak();
      voiceRef.current?.stopListening?.();
    },
    []
  );

  // Press-and-hold entry: begin listening the moment the model is ready, so the
  // hold gesture flows straight into a spoken request without a second tap.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoListen && qvac.isReady && phase === 'idle' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void stopSpeak();
      setError(null);
      voiceRef.current?.startListening();
    }
  }, [autoListen, qvac.isReady, phase]);

  const appendBubble = (role: Bubble['role'], text: string) => {
    const id = nextId();
    setBubbles((p) => [...p, { id, role, text }]);
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
    if (!aliveRef.current) return;
    setPhase('idle');
    setError(null);
    voiceRef.current?.startListening();
  }, []);

  const runTurn = useCallback(
    async (userText: string) => {
      setError(null);
      appendBubble('user', userText);
      const priorHistory = bubbles.map((b) => ({ role: b.role, content: b.text }));
      setPhase('thinking');
      const assistantId = appendBubble('assistant', '');
      let streamed = '';
      let reasoning = '';
      try {
        const res = await agent.runTurn(userText, {
          history: priorHistory,
          onToken: (tok) => {
            // Stream the answer into the bubble live + keep it scrolled into view.
            streamed += tok;
            patchBubble(assistantId, { text: streamed });
            scrollToEnd();
          },
          onThinking: (tok) => {
            reasoning += tok;
            patchBubble(assistantId, { thinking: reasoning });
          },
          onConfirm: (call) =>
            new Promise((resolve) => setConfirm({ call, resolve })),
        });
        const finalText = (res.text || streamed || 'Done.').trim();
        patchBubble(assistantId, { text: finalText });
        scrollToEnd();
        // Speak the reply with on-device QVAC TTS (falls back to the system
        // voice automatically if QVAC TTS isn't available). When it finishes,
        // listen again so the user can simply keep talking.
        setPhase('speaking');
        void stopSpeak();
        void qvacSpeak(finalText, {
          onDone: resumeListening,
          onError: () => setPhase('idle'),
        });
      } catch (e) {
        patchBubble(assistantId, { text: '' });
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPhase('idle');
      }
    },
    [bubbles, agent, resumeListening]
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
    if (qvac.llmStatus === 'error') {
      // Retry model init.
      setError(null);
      qvac.initialize();
      return;
    }
    if (!qvac.isReady) return;
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

  const orbStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(pulse.value, [0, 1], [1, phase === 'listening' ? 1.18 : 1.08]) },
      { rotate: `${interpolate(spin.value, [0, 1], [0, 360])}deg` },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.4, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.8]) }],
  }));

  const aiFailed = qvac.llmStatus === 'error';
  // The on-device model is still downloading/loading (not an error, not ready).
  const modelLoading = !aiFailed && !qvac.isReady;
  const statusText = aiFailed
    ? `On-device AI unavailable — ${qvac.error || 'the model could not be loaded'}`
    : !qvac.isReady
    ? qvac.isDownloading
      ? `Preparing the on-device AI… ${qvac.combinedProgress}%`
      : 'Starting the on-device AI…'
    : error
      ? error
      : phase === 'listening'
        ? 'Listening… tap to send'
        : phase === 'thinking'
          ? 'Thinking…'
          : phase === 'speaking'
            ? 'Speaking… tap to interrupt'
            : 'Tap the orb and speak';

  const orbColor =
    phase === 'thinking' ? theme.colors.secondary?.[500] ?? '#6F32FF' : theme.colors.primary[500];

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="sparkles" size={18} color={theme.colors.primary[500]} />
              <Text style={styles.headerTitle}>KaleidoMind</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          {/* Conversation */}
          <ScrollView
            ref={scrollRef}
            style={styles.convo}
            contentContainerStyle={{ paddingVertical: 12, gap: 10 }}
            showsVerticalScrollIndicator={false}
          >
            {bubbles.length === 0 && (
              <Text style={styles.hint}>
                Try: "What's my balance?" · "Create an invoice for 5000 sats" · "Show my receive address"
              </Text>
            )}
            {bubbles.map((b) => {
              const hasThinking = b.role === 'assistant' && !!b.thinking?.trim();
              if (!b.text && !hasThinking) return null;
              const open = !!openThinking[b.id];
              return (
                <View
                  key={b.id}
                  style={[styles.bubble, b.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
                >
                  {hasThinking && (
                    <>
                      <Pressable
                        onPress={() => setOpenThinking((p) => ({ ...p, [b.id]: !p[b.id] }))}
                        style={styles.thinkToggle}
                        hitSlop={6}
                      >
                        <Ionicons name="sparkles-outline" size={12} color={theme.colors.text.muted} />
                        <Text style={styles.thinkToggleText}>{open ? 'Hide thinking' : 'Show thinking'}</Text>
                        <Ionicons
                          name={open ? 'chevron-up' : 'chevron-down'}
                          size={12}
                          color={theme.colors.text.muted}
                        />
                      </Pressable>
                      {open && <Text style={styles.thinkText}>{b.thinking!.trim()}</Text>}
                    </>
                  )}
                  {!!b.text && (
                    <Text style={b.role === 'user' ? styles.bubbleUserText : styles.bubbleAssistantText}>
                      {b.text}
                    </Text>
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* Orb */}
          <Pressable
            onPress={toggleListening}
            style={styles.orbArea}
            disabled={!qvac.isReady && qvac.llmStatus !== 'error'}
          >
            <Animated.View style={[styles.orbRing, { backgroundColor: orbColor }, ringStyle]} />
            <Animated.View style={[styles.orb, { backgroundColor: orbColor }, orbStyle]}>
              {modelLoading || phase === 'thinking' ? (
                <ActivityIndicator color={theme.colors.text.inverse} />
              ) : (
                <Ionicons
                  name={phase === 'speaking' ? 'volume-high' : phase === 'listening' ? 'mic' : 'mic-outline'}
                  size={30}
                  color={theme.colors.text.inverse}
                />
              )}
            </Animated.View>
          </Pressable>
          {/* Loading progress bar while the on-device model downloads/loads. */}
          {modelLoading && (
            <View style={styles.loadTrack}>
              <View
                style={[
                  styles.loadFill,
                  { width: `${qvac.isDownloading ? qvac.combinedProgress : 100}%` },
                ]}
              />
            </View>
          )}
          <Text style={styles.status}>{statusText}</Text>

          {/* Hidden recorder */}
          <View style={{ height: 0, overflow: 'hidden' }}>
            <VoiceInput
              ref={voiceRef}
              onStart={() => setPhase('listening')}
              onEnd={() => setPhase((p) => (p === 'listening' ? 'thinking' : p))}
              onResult={onResult}
              onPartialResult={() => {}}
              onError={(e) => {
                setError(e || 'Could not hear you. Try again.');
                setPhase('idle');
              }}
            />
          </View>

          {/* Money-action confirm card */}
          {confirm && (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>Confirm action</Text>
              <Text style={styles.confirmBody}>
                {humanizeCall(confirm.call)}
              </Text>
              <View style={styles.confirmActions}>
                <Pressable
                  style={[styles.confirmBtn, styles.confirmDecline]}
                  onPress={() => {
                    confirm.resolve({ approved: false, reason: 'declined' });
                    setConfirm(null);
                  }}
                >
                  <Text style={styles.confirmDeclineText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.confirmBtn, styles.confirmApprove]}
                  onPress={() => {
                    confirm.resolve({ approved: true });
                    setConfirm(null);
                  }}
                >
                  <Text style={styles.confirmApproveText}>Approve</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

function humanizeCall(call: { name: string; arguments: Record<string, unknown> }): string {
  const a = call.arguments || {};
  if (call.name === 'pay_lightning_invoice') return `Pay a Lightning invoice${a.amount ? ` (${a.amount} sats)` : ''}?`;
  if (call.name === 'pay_nostr_contact') return `Send ${a.amount ?? ''} sats to ${a.contact ?? 'a contact'}?`;
  return `Run "${call.name}" with ${JSON.stringify(a)}?`;
}

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
    minHeight: '70%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.text.primary },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
  },
  convo: { flex: 1, minHeight: 240, marginTop: 8 },
  hint: { color: theme.colors.text.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 12 },
  bubble: { maxWidth: '85%', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 16 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: theme.colors.primary[500], borderBottomRightRadius: 5 },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: theme.colors.surface.secondary, borderBottomLeftRadius: 5 },
  bubbleUserText: { color: theme.colors.text.inverse, fontSize: 15, fontWeight: '500' },
  bubbleAssistantText: { color: theme.colors.text.primary, fontSize: 15 },
  thinkToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  thinkToggleText: { color: theme.colors.text.muted, fontSize: 12, fontWeight: '600' },
  thinkText: {
    color: theme.colors.text.secondary,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.border.medium,
  },
  loadTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface.secondary,
    overflow: 'hidden',
    marginTop: 10,
    marginHorizontal: 40,
  },
  loadFill: { height: '100%', borderRadius: 2, backgroundColor: theme.colors.primary[500] },
  orbArea: { alignItems: 'center', justifyContent: 'center', height: 130, marginTop: 8 },
  orbRing: { position: 'absolute', width: 92, height: 92, borderRadius: 46 },
  orb: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { textAlign: 'center', color: theme.colors.text.secondary, fontSize: 14, marginTop: 6, fontWeight: '500' },
  confirmCard: {
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: theme.colors.surface.elevated,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
  },
  confirmTitle: { color: theme.colors.text.primary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  confirmBody: { color: theme.colors.text.secondary, fontSize: 14, marginBottom: 14 },
  confirmActions: { flexDirection: 'row', gap: 10 },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  confirmDecline: { backgroundColor: theme.colors.surface.secondary },
  confirmDeclineText: { color: theme.colors.text.primary, fontWeight: '600' },
  confirmApprove: { backgroundColor: theme.colors.primary[500] },
  confirmApproveText: { color: theme.colors.text.inverse, fontWeight: '700' },
});

export default VoiceAgentOverlay;
