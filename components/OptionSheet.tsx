import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../theme/ThemeProvider';
import { feedback } from '../utils/feedback';
import { Drawer } from './ui/overlays';
import { Typography } from './ui/typography';
import { ToneBadge } from './ui/surfaces';

export interface SheetOption {
  id: string;
  label: string;
  description?: string;
  preview?: string;
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
export function OptionSheet({
  visible,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: OptionSheetProps) {
  const t = useAppTheme();
  return (
    <Drawer visible={visible} title={title} onClose={onClose}>
      {options.map((option) => {
        const active = option.id === selectedId;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: active }}
            onPress={() => {
              feedback.select();
              onSelect(option.id);
              onClose();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing[3],
              padding: t.spacing[3],
              minHeight: 44,
              borderRadius: t.borderRadius.md,
              borderWidth: 1,
              borderColor: active
                ? t.colors.primary[500]
                : t.colors.border.light,
              backgroundColor: active
                ? t.colors.primary[50]
                : t.colors.surface.secondary,
            }}
          >
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={20}
              color={active ? t.colors.primary[500] : t.colors.text.secondary}
            />
            <View style={{ flex: 1, gap: t.spacing[1] }}>
              <Typography>{option.label}</Typography>
              {option.description && (
                <Typography role="caption" muted>
                  {option.description}
                </Typography>
              )}
              {option.badge && (
                <ToneBadge tone="primary" label={option.badge} />
              )}
            </View>
            {option.preview != null && (
              <Typography
                role="caption"
                mono
                style={{ flexShrink: 1, maxWidth: '35%', textAlign: 'right' }}
              >
                {option.preview}
              </Typography>
            )}
          </Pressable>
        );
      })}
    </Drawer>
  );
}
export default OptionSheet;
