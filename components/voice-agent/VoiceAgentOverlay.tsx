import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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
import { useSelector } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../theme';
import { MindAvatar } from '../MindMark';
import VoiceInput, { VoiceInputRef } from '../VoiceInput';
import { useQVAC } from '../../hooks/useQVAC';
import { createMindAgent } from '../../services/mindAgent';
import { startHandsFreeVoice, type HandsFreeController } from '../../services/handsFreeVoice';
import { selectMindConfig } from '../../store/slices/settingsSlice';

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
  const insets = useSafeAreaInsets();
  // Same KaleidoMind funnel AND settings as the chat screen — fast-path,
  // recipes, contract wallet tools, memory + on-device RAG, confirm gate,
  // persona/sampling/toggles. Settings are read per turn through the ref.
  const mindConfig = useSelector(selectMindConfig);
  const mindConfigRef = useRef(mindConfig);
  mindConfigRef.current = mindConfig;
  const agent = useMemo(
    () => createMindAgent(qvac.service, () => mindConfigRef.current),
    [qvac.service],
  );
  const voiceRef = useRef<VoiceInputRef>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
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
  // Latest bubbles, read inside the hands-free respond closure (created once
  // when the loop starts) to build turn history without a stale snapshot.
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

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
      handsFreeRef.current?.stop();
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
      setActiveId(assistantId);
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
            scrollToEnd();
          },
          onConfirm: (call) =>
            new Promise((resolve) => setConfirm({ call, resolve })),
        });
        const finalText = (res.text?.trim() || streamed.trim() || NO_ANSWER_FALLBACK);
        patchBubble(assistantId, { text: finalText });
        setActiveId(null);
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
        setActiveId(null);
        setError(friendlyError(e));
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

  // ── Hands-free (continuous VAD) ─────────────────────────────────────────────
  // Resolve when the spoken reply finishes playing (onDone), so the loop's mic
  // re-gate + cooldown timing stays correct.
  const speakHandsFree = (text: string): Promise<void> =>
    new Promise((resolve) => {
      void stopSpeak();
      void qvacSpeak(text, { onDone: () => resolve(), onError: () => resolve() });
    });

  // Run one turn for a transcribed utterance and return the reply text — same
  // agent/settings/confirm-gate as chat + push-to-talk, streamed into a bubble.
  const respondHandsFree = async (transcript: string): Promise<string> => {
    appendBubble('user', transcript);
    const priorHistory = bubblesRef.current.map((b) => ({ role: b.role, content: b.text }));
    const assistantId = appendBubble('assistant', '');
    setActiveId(assistantId);
    let streamed = '';
    let reasoning = '';
    try {
      const res = await agent.runTurn(transcript, {
        history: priorHistory,
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
        onConfirm: (call) => new Promise((resolve) => setConfirm({ call, resolve })),
      });
      const finalText = (res.text?.trim() || streamed.trim() || NO_ANSWER_FALLBACK);
      patchBubble(assistantId, { text: finalText });
      scrollToEnd();
      return finalText;
    } finally {
      setActiveId(null);
    }
  };

  const stopHandsFree = () => {
    handsFreeRef.current?.stop();
    handsFreeRef.current = null;
    setHandsFree(false);
    setPhase('idle');
  };

  const startHandsFree = async () => {
    if (handsFreeRef.current || !qvac.isReady) return;
    setError(null);
    setHandsFree(true);
    void stopSpeak();
    voiceRef.current?.stopListening?.(); // never run both mic paths at once
    try {
      handsFreeRef.current = await startHandsFreeVoice({
        respond: respondHandsFree,
        speak: speakHandsFree,
        onState: (s) => setPhase(s),
        onError: (e) => {
          setError(e instanceof Error ? e.message : 'Voice loop stopped.');
          stopHandsFree();
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start hands-free voice.');
      setHandsFree(false);
      setPhase('idle');
    }
  };

  const toggleHandsFree = () => {
    if (handsFree) stopHandsFree();
    else void startHandsFree();
  };

  const orbStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(pulse.value, [0, 1], [1, phase === 'listening' ? 1.18 : 1.08]) },
      { rotate: `${interpolate(spin.value, [0, 1], [0, 360])}deg` },
    ] as const,
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
              <MindAvatar size={28} />
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
              const hasText = !!b.text?.trim();
              if (!hasText && !hasThinking) return null;
              const isActive = b.id === activeId;
              // Live reasoning, no answer yet → show it expanded (Claude-style);
              // once the answer streams in, auto-collapse. A manual tap overrides.
              const thinkingLive = isActive && hasThinking && !hasText;
              const open = openThinking[b.id] ?? thinkingLive;
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
                          {thinkingLive ? 'Thinking…' : open ? 'Hide thinking' : 'Show thinking'}
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
                              <Text style={styles.copyBtnText}>Copy thinking</Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                  {hasText && (
                    <Text
                      selectable
                      style={b.role === 'user' ? styles.bubbleUserText : styles.bubbleAssistantText}
                    >
                      {b.text}
                    </Text>
                  )}
                  {/* Discoverable copy affordance on finished assistant replies. */}
                  {b.role === 'assistant' && hasText && !isActive && (
                    <Pressable onPress={() => copyText(b.text)} style={styles.copyBtn} hitSlop={8}>
                      <Ionicons name="copy-outline" size={13} color={theme.colors.text.muted} />
                      <Text style={styles.copyBtnText}>Copy</Text>
                    </Pressable>
                  )}
                </Pressable>
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

          {/* Hands-free (continuous VAD) toggle. Needs @qvac/sdk ≥ 0.13.1 + the
              react-native-live-audio-stream native module (see services/micStream.ts);
              the orb above is the one-shot push-to-talk path and works without them. */}
          <Pressable
            onPress={toggleHandsFree}
            disabled={!qvac.isReady && qvac.llmStatus !== 'error'}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              marginTop: 10,
              opacity: qvac.isReady ? 1 : 0.4,
            }}
          >
            <Ionicons
              name={handsFree ? 'infinite' : 'infinite-outline'}
              size={16}
              color={handsFree ? theme.colors.brand.violet : theme.colors.text.secondary}
            />
            <Text
              style={{
                fontSize: 13,
                color: handsFree ? theme.colors.brand.violet : theme.colors.text.secondary,
              }}
            >
              {handsFree ? 'Hands-free on' : 'Hands-free'}
            </Text>
          </Pressable>

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

        </View>

        {/* Money-action confirm — a bottom-anchored overlay above the sheet so
            it's always fully on-screen and tappable (an in-flow card overflowed
            the max-height sheet and got clipped off the bottom edge). */}
        {confirm && (
          <View style={styles.confirmOverlay}>
            {/* Tap outside the card to dismiss (treated as a decline). */}
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                confirm.resolve({ approved: false, reason: 'declined' });
                setConfirm(null);
              }}
            />
            <View style={[styles.confirmCard, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
              <View style={styles.confirmHandle} />
              <View style={styles.confirmTitleRow}>
                <Ionicons name="shield-checkmark" size={18} color={theme.colors.primary[500]} />
                <Text style={styles.confirmTitle}>Confirm action</Text>
              </View>
              <Text style={styles.confirmBody}>{humanizeCall(confirm.call)}</Text>
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
          </View>
        )}
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
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  confirmCard: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.colors.surface.elevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.medium,
  },
  confirmHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: theme.colors.border.medium,
    marginBottom: 14,
  },
  confirmTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  confirmTitle: { color: theme.colors.text.primary, fontWeight: '700', fontSize: 16 },
  confirmBody: { color: theme.colors.text.secondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  confirmActions: { flexDirection: 'row', gap: 10 },
  confirmBtn: { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  confirmDecline: { backgroundColor: theme.colors.surface.secondary },
  confirmDeclineText: { color: theme.colors.text.primary, fontWeight: '600' },
  confirmApprove: { backgroundColor: theme.colors.primary[500] },
  confirmApproveText: { color: theme.colors.text.inverse, fontWeight: '700' },
});

export default VoiceAgentOverlay;
