/**
 * OptionSheet — a reusable single-select bottom sheet for settings.
 * Replaces the old "tap a row to blind-cycle" pattern with a proper picker that
 * shows every option, an optional description, a live preview, and the current
 * selection — mirroring rate-extension's settings selectors.
 */
import React from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';

export interface SheetOption {
  id: string;
  label: string;
  /** Short explanation under the label. */
  description?: string;
  /** Live preview of what this option produces (right-aligned, mono). */
  preview?: string;
  /** Small accent badge, e.g. "Recommended". */
  badge?: string;
}

interface OptionSheetProps {
  visible: boolean;
  title: string;
  options: SheetOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const OptionSheet: React.FC<OptionSheetProps> = ({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}) => {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={theme.colors.text.tertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {options.map((o) => {
              const active = o.id === selectedId;
              return (
                <TouchableOpacity
                  key={o.id}
                  activeOpacity={0.7}
                  onPress={() => { feedback.select(); onSelect(o.id); onClose(); }}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.labelRow}>
                      <Text style={[styles.optionLabel, active && { color: theme.colors.primary[500] }]}>
                        {o.label}
                      </Text>
                      {o.badge && (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{o.badge}</Text>
                        </View>
                      )}
                    </View>
                    {o.description && <Text style={styles.optionDesc}>{o.description}</Text>}
                  </View>
                  {o.preview != null && <Text style={styles.preview} numberOfLines={1}>{o.preview}</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700', color: theme.colors.text.primary },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.background.secondary,
  },
  optionActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[500] + '12',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: theme.colors.primary[500] },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary[500],
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.text.primary },
  optionDesc: { fontSize: 12, color: theme.colors.text.tertiary, marginTop: 2 },
  preview: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    fontFamily: mono,
    marginLeft: 8,
    maxWidth: 120,
    textAlign: 'right',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: theme.colors.primary[500] + '1A',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: theme.colors.primary[500],
  },
});

export default OptionSheet;
