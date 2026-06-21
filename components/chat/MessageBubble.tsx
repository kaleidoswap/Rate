// components/chat/MessageBubble.tsx
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from 'react-native-markdown-display';
import { ChatBubble } from '@kaleidorg/kaleido-ui/native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { leading, type Theme } from '../../theme';
import TypingDots from './TypingDots';
import { MindAvatar } from '../MindMark';
import FunctionResultCard from './FunctionResultCard';
import { findPayable, stripPayable } from '../../utils/decodeInvoice';
import { PayableCard } from './PayableCard';
import { BalanceCard } from './BalanceCard';

/** Real per-turn inference numbers (from QVAC), shown under an answer. */
export interface ChatMsgStats {
  tokensPerSecond?: number;
  totalTokens?: number;
  promptTokens?: number;
  device?: 'cpu' | 'gpu';
}

export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  functionCalled?: string;
  functionResult?: any;
  streaming?: boolean;
  /** The model's chain-of-thought for this reply (revealed on tap). */
  thinking?: string;
  /** Real inference stats for this answer (tok/s, tokens, backend) — see StatsFooter. */
  stats?: ChatMsgStats;
  /** Structured card to render in place of (or alongside) the text. */
  card?: { type: 'balance' | 'contact' | 'merchant'; data: any };
}

/** Compact, desktop-parity stats line: tok/s · tokens · GPU/CPU. */
const StatsFooter: React.FC<{ stats: ChatMsgStats; styles: ReturnType<typeof makeStyles>; theme: Theme }> = ({ stats, styles, theme }) => {
  const { tokensPerSecond, totalTokens, device } = stats;
  const hasAny = (typeof tokensPerSecond === 'number' && tokensPerSecond > 0) || typeof totalTokens === 'number' || !!device;
  if (!hasAny) return null;
  return (
    <View style={styles.statsRow}>
      {typeof tokensPerSecond === 'number' && tokensPerSecond > 0 && (
        <View style={styles.statChip}>
          <Ionicons name="speedometer-outline" size={11} color={theme.colors.text.tertiary} />
          <Text style={styles.statText}>{tokensPerSecond.toFixed(1)} tok/s</Text>
        </View>
      )}
      {typeof totalTokens === 'number' && (
        <View style={styles.statChip}>
          <Ionicons name="layers-outline" size={11} color={theme.colors.text.tertiary} />
          <Text style={styles.statText}>{totalTokens.toLocaleString('en-US')} tokens</Text>
        </View>
      )}
      {device && (
        <View style={styles.statChip}>
          <Ionicons name={device === 'gpu' ? 'flash-outline' : 'hardware-chip-outline'} size={11} color={theme.colors.text.tertiary} />
          <Text style={styles.statText}>{device === 'gpu' ? 'GPU' : 'CPU'}</Text>
        </View>
      )}
    </View>
  );
};

interface MessageBubbleProps {
  message: ChatMessage;
  onCopy: (text: string, label?: string) => void;
  onOpenLink: (url: string) => void;
  /** Tap a contact in a list_contacts card (e.g. to start a payment). */
  onSelectContact?: (name: string) => void;
  /** Long-press a bubble to copy its text. */
  onLongPress: (message: ChatMessage) => void;
}

/**
 * A single chat row. The shell (row alignment, entrance animation, bubble
 * container, timestamp) comes from the shared kaleido-ui/native ChatBubble so
 * web + mobile share one bubble; the app-specific content (gradient avatar,
 * markdown, thinking toggle, structured cards) is composed in here.
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onCopy, onOpenLink, onLongPress, onSelectContact }) => {
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const mdStyles = useMemo(() => makeMarkdownStyles(theme), [theme]);

  const [showThinking, setShowThinking] = useState(false);

  const isUser = message.isUser;
  const hasThinking = !isUser && !!message.thinking?.trim();
  // Detect a Lightning invoice / address / RGB invoice in an AI reply → render a card.
  const payable = useMemo(() => (!isUser && !message.streaming ? findPayable(message.text) : null), [isUser, message.streaming, message.text]);

  const avatar = isUser ? (
    <LinearGradient colors={theme.colors.warning.gradient!} style={styles.avatar}>
      <Ionicons name="person" size={16} color="#fff" />
    </LinearGradient>
  ) : (
    <MindAvatar size={32} style={styles.avatar} />
  );

  return (
    <ChatBubble
      role={isUser ? 'user' : 'assistant'}
      avatar={avatar}
      time={formatTime(message.timestamp)}
      onLongPress={() => onLongPress(message)}
    >
      {isUser ? (
        <Text style={styles.userText}>{message.text}</Text>
      ) : (
        <View>
          {hasThinking && (
            <>
              <Pressable
                onPress={() => setShowThinking((v) => !v)}
                style={styles.thinkToggle}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={showThinking ? 'Hide reasoning' : 'Show reasoning'}
              >
                <Ionicons name="sparkles-outline" size={13} color={theme.colors.text.tertiary} />
                <Text style={styles.thinkToggleText}>
                  {showThinking ? 'Hide thinking' : 'Show thinking'}
                </Text>
                <Ionicons
                  name={showThinking ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color={theme.colors.text.tertiary}
                />
              </Pressable>
              {showThinking && <Text style={styles.thinkText}>{message.thinking!.trim()}</Text>}
            </>
          )}
          {message.streaming && !message.text.trim() ? (
            <TypingDots />
          ) : message.card?.type === 'balance' ? (
            <BalanceCard data={message.card.data} />
          ) : payable ? (
            <>
              {stripPayable(message.text, payable).trim() ? (
                <Markdown style={mdStyles}>{stripPayable(message.text, payable)}</Markdown>
              ) : null}
              <PayableCard payable={payable} onCopy={onCopy} />
            </>
          ) : (
            <Markdown style={mdStyles}>{message.text}</Markdown>
          )}
          {message.functionCalled && message.functionResult ? (
            <FunctionResultCard
              functionCalled={message.functionCalled}
              functionResult={message.functionResult}
              onCopy={onCopy}
              onOpenLink={onOpenLink}
              onSelectContact={onSelectContact}
            />
          ) : null}
          {!message.streaming && message.stats && (
            <StatsFooter stats={message.stats} styles={styles} theme={theme} />
          )}
          {/* Discoverable copy on a settled assistant reply — copies the answer
              plus its reasoning when present (long-press the bubble also works). */}
          {!message.streaming && !!message.text?.trim() && (
            <View style={styles.copyRow}>
              <TouchableOpacity
                onPress={() => onCopy(buildCopyText(message), 'Message')}
                style={styles.copyBtn}
                hitSlop={8}
                accessibilityLabel="Copy message"
              >
                <Ionicons name="copy-outline" size={13} color={theme.colors.text.tertiary} />
                <Text style={styles.copyBtnText}>Copy</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ChatBubble>
  );
};

const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Plain-text copy of a message — its reasoning AND answer when both exist. */
export const buildCopyText = (message: ChatMessage): string =>
  [message.thinking?.trim() ? `Thinking:\n${message.thinking.trim()}` : '', message.text?.trim() ?? '']
    .filter(Boolean)
    .join('\n\n');

const makeMarkdownStyles = (theme: Theme) => ({
  body: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    lineHeight: leading(theme.typography.fontSize.base, theme.typography.lineHeight.normal),
  },
  code_inline: {
    backgroundColor: theme.colors.surface.secondary,
    color: theme.colors.primary[400] ?? theme.colors.primary[500],
    borderRadius: theme.borderRadius.sm,
    paddingHorizontal: theme.spacing[1],
  },
  fence: {
    backgroundColor: theme.colors.surface.secondary,
    color: theme.colors.text.primary,
    borderColor: theme.colors.border.light,
  },
  link: {
    color: theme.colors.text.link,
    textDecorationLine: 'underline' as const,
  },
});

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    avatar: {
      width: 32,
      height: 32,
      borderRadius: theme.borderRadius.full,
      justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: theme.spacing[3],
      marginBottom: theme.spacing[1],
    },
    userText: {
      fontSize: theme.typography.fontSize.base,
      lineHeight: leading(theme.typography.fontSize.base, theme.typography.lineHeight.normal),
      color: theme.colors.text.inverse, // dark text on the green user bubble fill (correct contrast)
      fontWeight: theme.typography.fontWeight.medium,
    },
    thinkToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing[1],
      marginBottom: theme.spacing[2],
    },
    thinkToggleText: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.text.tertiary,
      fontWeight: theme.typography.fontWeight.semibold,
    },
    thinkText: {
      fontSize: theme.typography.fontSize.sm,
      fontStyle: 'italic',
      color: theme.colors.text.secondary,
      lineHeight: leading(theme.typography.fontSize.sm, theme.typography.lineHeight.relaxed),
      marginBottom: theme.spacing[2],
      paddingLeft: theme.spacing[2],
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border.medium,
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.spacing[2.5] ?? 10,
      marginTop: theme.spacing[2],
      paddingTop: theme.spacing[1.5] ?? 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border.light,
    },
    statChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    statText: { fontSize: 11, color: theme.colors.text.tertiary, fontWeight: theme.typography.fontWeight.medium },
    copyRow: { flexDirection: 'row', marginTop: theme.spacing[1.5] ?? 6 },
    copyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: theme.borderRadius.full ?? 999,
      backgroundColor: theme.colors.surface.secondary,
    },
    copyBtnText: { fontSize: 11, color: theme.colors.text.tertiary, fontWeight: theme.typography.fontWeight.medium },
  });

export default React.memo(MessageBubble);
