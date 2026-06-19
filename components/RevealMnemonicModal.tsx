import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Clipboard,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';

interface RevealMnemonicModalProps {
  visible: boolean;
  mnemonic: string | null;
  onClose: () => void;
}

/**
 * Auth-gated recovery-phrase reveal. The caller is responsible for
 * authenticating the user (biometric / device passcode) BEFORE rendering this
 * with a non-null mnemonic. The words stay blurred behind a tap-to-reveal until
 * the user opts in, to guard against shoulder-surfing / accidental screenshots.
 */
export const RevealMnemonicModal: React.FC<RevealMnemonicModalProps> = ({ visible, mnemonic, onClose }) => {
  const [revealed, setRevealed] = useState(false);

  // Re-hide whenever the modal is re-opened.
  useEffect(() => {
    if (visible) setRevealed(false);
  }, [visible]);

  const words = (mnemonic ?? '').trim().split(/\s+/).filter(Boolean);

  const handleCopy = () => {
    if (!mnemonic) return;
    Clipboard.setString(mnemonic);
    Alert.alert('Copied', 'Recovery phrase copied. Clear your clipboard once you have stored it safely.');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Recovery Phrase</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.warning}>
            <Ionicons name="warning-outline" size={18} color={theme.colors.warning[500]} />
            <Text style={styles.warningText}>
              Anyone with these words can steal your funds. Make sure no one is watching, and never share them or
              type them into a website.
            </Text>
          </View>

          <View style={styles.gridWrap}>
            <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
              {words.map((word, i) => (
                <View key={`${i}-${word}`} style={styles.wordChip}>
                  <Text style={styles.wordIndex}>{i + 1}</Text>
                  <Text style={styles.wordText}>{word}</Text>
                </View>
              ))}
            </ScrollView>

            {!revealed && (
              <TouchableOpacity
                style={styles.blurCover}
                activeOpacity={0.9}
                onPress={() => setRevealed(true)}
                accessibilityRole="button"
                accessibilityLabel="Tap to reveal recovery phrase"
              >
                <Ionicons name="eye-off-outline" size={28} color={theme.colors.text.secondary} />
                <Text style={styles.blurText}>Tap to reveal</Text>
              </TouchableOpacity>
            )}
          </View>

          {revealed && (
            <TouchableOpacity style={styles.copyButton} onPress={handleCopy} accessibilityRole="button">
              <Ionicons name="copy-outline" size={18} color={theme.colors.primary[500]} />
              <Text style={styles.copyText}>Copy to clipboard</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.doneButton} onPress={onClose} accessibilityRole="button">
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.background.backdrop,
    justifyContent: 'center',
    padding: theme.spacing[5],
  },
  sheet: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[5],
    gap: theme.spacing[3.5],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
  },
  warning: {
    flexDirection: 'row',
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.warning[50],
    borderWidth: 1,
    borderColor: theme.colors.warning[500] + '40', // ~25% warning tint border — no static token for this alpha
  },
  warningText: {
    flex: 1,
    fontSize: theme.typography.fontSize.xs,
    lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.normal),
    color: theme.colors.text.secondary,
  },
  gridWrap: {
    position: 'relative',
    minHeight: 180,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
    justifyContent: 'space-between',
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1.5],
    width: '48%',
    paddingVertical: theme.spacing[2.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.background.tertiary,
  },
  wordIndex: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.tertiary,
    minWidth: 18,
  },
  wordText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
  },
  blurCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.background.secondary + 'F2', // ~95% opaque cover so the seed stays hidden until tapped
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1.5],
  },
  blurText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.secondary,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[2.5],
  },
  copyText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.primary[500],
  },
  doneButton: {
    paddingVertical: theme.spacing[3.5],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
  },
  doneText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.inverse, // dark navy text on green primary fill (correct contrast)
  },
});
