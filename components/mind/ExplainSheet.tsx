// "Explain" for one item: a small sheet with Prismo and 2–4 plain sentences,
// from the on-device model when it is loaded, else a built-in explanation.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { Sheet } from '../Sheet';
import { MindCharacter } from './MindCharacter';
import { explain, explainTitle, type ExplainSubject, type Explanation } from '../../services/mindExplain';
import { localTextModel } from '../../services/mindIntents/model';

export function ExplainSheet({ subject, onClose }: { subject: ExplainSubject | null; onClose: () => void }) {
  const [result, setResult] = useState<Explanation | null>(null);
  useEffect(() => {
    setResult(null);
    if (!subject) return;
    let live = true;
    explain(subject, localTextModel()).then((r) => { if (live) setResult(r); });
    return () => { live = false; };
  }, [subject]);

  return (
    <Sheet visible={!!subject} onClose={onClose} title={subject ? explainTitle(subject) : undefined} testID="explain-sheet">
      <View style={styles.body}>
        <MindCharacter mood={result ? 'speaking' : 'thinking'} size={44} />
        <View style={styles.textCol}>
          <Text style={styles.text} accessibilityLiveRegion="polite">{result?.text ?? 'Thinking…'}</Text>
          {!!result && (
            <Text style={styles.caption}>
              {result.source === 'model' ? 'Explained on this phone by KaleidoMind.' : 'Built-in explanation. Turn on KaleidoMind for one written for this item.'}
            </Text>
          )}
        </View>
      </View>
    </Sheet>
  );
}

/** A small "Explain" link that opens the sheet for `subject`. */
export function ExplainButton({ subject, label = 'Explain', style, compact }: {
  subject: ExplainSubject; label?: string; style?: StyleProp<ViewStyle>; compact?: boolean;
}) {
  const [open, setOpen] = useState<ExplainSubject | null>(null);
  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${explainTitle(subject).toLowerCase()}`}
        onPress={() => setOpen(subject)}
        style={[styles.button, compact && styles.compact, style]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="sparkles-outline" size={compact ? 12 : 14} color={theme.colors.primary[500]} />
        <Text style={[styles.buttonText, compact && styles.compactText]}>{label}</Text>
      </TouchableOpacity>
      <ExplainSheet subject={open} onClose={() => setOpen(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', gap: theme.spacing[3], alignItems: 'flex-start', paddingBottom: theme.spacing[4] },
  textCol: { flex: 1, gap: theme.spacing[2] },
  text: { fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, lineHeight: 22 },
  caption: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
  button: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[1], alignSelf: 'center',
    paddingHorizontal: theme.spacing[3], paddingVertical: theme.spacing[1.5], borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary[500] + '1A',
  },
  compact: { paddingHorizontal: theme.spacing[2], paddingVertical: theme.spacing[0.5], alignSelf: 'auto' },
  buttonText: { fontSize: theme.typography.fontSize.sm, color: theme.colors.primary[500], fontWeight: theme.typography.fontWeight.semibold },
  compactText: { fontSize: theme.typography.fontSize.xs },
});
