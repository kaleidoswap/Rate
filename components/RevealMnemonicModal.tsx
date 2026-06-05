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
import { theme } from '../theme';

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
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    backgroundColor: theme.colors.background.secondary,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  warning: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.warning[500] + '14',
    borderWidth: 1,
    borderColor: theme.colors.warning[500] + '40',
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.text.secondary,
  },
  gridWrap: {
    position: 'relative',
    minHeight: 180,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  wordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    width: '48%',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: theme.colors.background.tertiary || 'rgba(255,255,255,0.05)',
  },
  wordIndex: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
    minWidth: 18,
  },
  wordText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  blurCover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.background.secondary + 'F2',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  blurText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  copyText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary[500],
  },
  doneButton: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
  },
  doneText: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
});
