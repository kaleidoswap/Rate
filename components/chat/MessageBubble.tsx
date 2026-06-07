// components/chat/MessageBubble.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Markdown from 'react-native-markdown-display';
import { useAppTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme';
import TypingDots from './TypingDots';
import FunctionResultCard from './FunctionResultCard';

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
}

interface MessageBubbleProps {
  message: ChatMessage;
  onCopy: (text: string, label?: string) => void;
  onOpenLink: (url: string) => void;
  /** Long-press a bubble to copy its text. */
  onLongPress: (message: ChatMessage) => void;
}

/**
 * A single chat row: gradient avatar + bubble + timestamp. Self-animates its
 * entrance on mount (replacing the screen-level Animated.Value Map), and is
 * memoized so unrelated state changes don't re-render the whole history.
 */
const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onCopy, onOpenLink, onLongPress }) => {
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const mdStyles = useMemo(() => makeMarkdownStyles(theme), [theme]);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, tension: 120, friction: 9, useNativeDriver: true }).start();
  }, [enter]);

  const [showThinking, setShowThinking] = useState(false);

  const isUser = message.isUser;
  const hasThinking = !isUser && !!message.thinking?.trim();

  return (
    <Animated.View
      style={[
        styles.row,
        isUser ? styles.rowUser : styles.rowAi,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      {!isUser && (
        <LinearGradient colors={theme.colors.primary.gradient!} style={styles.avatar}>
          <Ionicons name="sparkles" size={16} color="#fff" />
        </LinearGradient>
      )}

      <TouchableOpacity
        activeOpacity={0.9}
        onLongPress={() => onLongPress(message)}
        delayLongPress={300}
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}
        accessibilityRole="text"
      >
        {isUser ? (
          <LinearGradient
            colors={theme.colors.primary.gradient!}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.userGradient}
          >
            <Text style={styles.userText}>{message.text}</Text>
            <Text style={styles.userTime}>{formatTime(message.timestamp)}</Text>
          </LinearGradient>
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
            ) : (
              <Markdown style={mdStyles}>{message.text}</Markdown>
            )}
            {message.functionCalled && message.functionResult ? (
              <FunctionResultCard
                functionCalled={message.functionCalled}
                functionResult={message.functionResult}
                onCopy={onCopy}
                onOpenLink={onOpenLink}
              />
            ) : null}
            <Text style={styles.aiTime}>{formatTime(message.timestamp)}</Text>
          </View>
        )}
      </TouchableOpacity>

      {isUser && (
        <LinearGradient colors={theme.colors.warning.gradient!} style={styles.avatar}>
          <Ionicons name="person" size={16} color="#fff" />
        </LinearGradient>
      )}
    </Animated.View>
  );
};

const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const makeMarkdownStyles = (theme: Theme) => ({
  body: {
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
    lineHeight: 24,
  },
  code_inline: {
    backgroundColor: theme.colors.surface.secondary,
    color: theme.colors.primary[400] ?? theme.colors.primary[500],
    borderRadius: 4,
    paddingHorizontal: 4,
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
    row: {
      flexDirection: 'row',
      marginBottom: theme.spacing[4],
      alignItems: 'flex-end',
      width: '100%',
    },
    rowUser: { justifyContent: 'flex-end' },
    rowAi: { justifyContent: 'flex-start' },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: theme.spacing[3],
      marginBottom: theme.spacing[1],
    },
    bubble: {
      maxWidth: '78%',
      borderRadius: theme.borderRadius.xl,
      overflow: 'hidden',
    },
    bubbleUser: { alignSelf: 'flex-end' },
    bubbleAi: {
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surface.primary,
      padding: theme.spacing[4],
      ...theme.shadows.md,
    },
    userGradient: { padding: theme.spacing[4] },
    userText: {
      fontSize: theme.typography.fontSize.base,
      lineHeight: 24,
      color: theme.colors.text.inverse,
      fontWeight: '500',
    },
    userTime: {
      fontSize: theme.typography.fontSize.xs,
      marginTop: theme.spacing[2],
      fontWeight: '500',
      color: 'rgba(255,255,255,0.9)',
      textAlign: 'right',
    },
    aiTime: {
      fontSize: theme.typography.fontSize.xs,
      marginTop: theme.spacing[2],
      fontWeight: '500',
      color: theme.colors.text.tertiary,
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
      fontWeight: '600',
    },
    thinkText: {
      fontSize: theme.typography.fontSize.sm,
      fontStyle: 'italic',
      color: theme.colors.text.secondary,
      lineHeight: 20,
      marginBottom: theme.spacing[2],
      paddingLeft: theme.spacing[2],
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border.medium,
    },
  });

export default React.memo(MessageBubble);
