// components/PhotoChoiceSheet.tsx
//
// One choice for a profile photo or banner: pick a photo from the library,
// paste a link to an image, or remove the current one.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { feedback } from '../utils/feedback';
import { isHttpUrl } from '../utils/nostrProfile';
import { Sheet } from './Sheet';
import { Input } from './Input';
import { Button } from './Button';

interface Props {
  visible: boolean;
  /** What is being changed, e.g. "Profile photo" or "Banner". */
  title: string;
  /** The current link, if one is set. */
  current: string;
  /** Where chosen photos are uploaded, shown as a notice. */
  uploadHost: string;
  onChoosePhoto: () => void;
  onUseLink: (url: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function PhotoChoiceSheet({ visible, title, current, uploadHost, onChoosePhoto, onUseLink, onRemove, onClose }: Props) {
  const [pasting, setPasting] = useState(false);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) return;
    setPasting(false);
    setLink(current);
    setError(undefined);
  }, [visible, current]);

  const useLink = () => {
    const url = link.trim();
    if (!isHttpUrl(url)) {
      setError('Enter a link starting with https://');
      return;
    }
    feedback.select();
    onUseLink(url);
  };

  const row = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, danger = false) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => { feedback.select(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={danger ? theme.colors.error[500] : theme.colors.text.secondary} />
      <Text style={[styles.rowText, danger && styles.danger]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={pasting ? <Button title="Use link" onPress={useLink} disabled={!link.trim()} style={styles.footer} /> : undefined}
    >
      {pasting ? (
        <Input
          label="Image link"
          placeholder="https://…"
          value={link}
          onChangeText={text => { setLink(text); if (error) setError(undefined); }}
          error={error}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={useLink}
        />
      ) : (
        <View style={styles.list}>
          {row('images-outline', 'Choose a photo', onChoosePhoto)}
          {row('link-outline', 'Paste a link', () => setPasting(true))}
          {!!current.trim() && row('trash-outline', 'Remove', onRemove, true)}
        </View>
      )}
      <Text style={styles.notice}>Photos you choose are uploaded to a public media server ({uploadHost}).</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: theme.colors.background.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  rowText: { fontSize: theme.typography.fontSize.sm, fontWeight: theme.typography.fontWeight.semibold, color: theme.colors.text.primary },
  danger: { color: theme.colors.error[500] },
  notice: { marginTop: theme.spacing[3], fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
  footer: { marginTop: theme.spacing[3] },
});
