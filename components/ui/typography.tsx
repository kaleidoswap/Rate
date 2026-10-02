import React from 'react';
import { Text, TextProps } from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { typeRoles } from '../../theme/partner';

export type TextRole = keyof typeof typeRoles | 'eyebrow';
export function Typography({
  role = 'body',
  muted,
  mono,
  style,
  ...props
}: Omit<TextProps, 'role'> & {
  role?: TextRole;
  muted?: boolean;
  mono?: boolean;
}) {
  const t = useAppTheme();
  return (
    <Text
      {...props}
      style={[
        {
          color: muted ? t.colors.text.secondary : t.colors.text.primary,
          fontFamily: mono
            ? t.typography.fontFamily.mono
            : t.typography.fontFamily.medium,
        },
        typeRoles[role === 'eyebrow' ? 'mini' : role],
        role === 'eyebrow' && {
          textTransform: 'uppercase',
          letterSpacing: typeRoles.mini.fontSize * 0.18,
          fontFamily: t.typography.fontFamily.bold,
        },
        ['title', 'headline', 'display'].includes(role) && {
          fontFamily: t.typography.fontFamily.bold,
        },
        style,
      ]}
    />
  );
}
