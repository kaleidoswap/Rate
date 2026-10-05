import React, { useState } from 'react';
import {
  Image,
  View,
  ViewProps,
  TextInput,
  TextInputProps,
  Pressable,
} from 'react-native';
import { useAppTheme } from '../../theme/ThemeProvider';
import { Typography } from './typography';
import { CopyButton } from '../CopyButton';

export type Tone =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'
  | 'purple';
export function useTone(tone: Tone = 'default') {
  const t = useAppTheme();
  return {
    default: t.colors.text.primary,
    muted: t.colors.text.secondary,
    primary: t.colors.primary[500],
    success: t.colors.success[500],
    warning: t.colors.warning[500],
    danger: t.colors.error[500],
    info: t.colors.info[500],
    purple: t.colors.secondary[500],
  }[tone];
}

export function Surface({ children, style, ...props }: ViewProps) {
  const t = useAppTheme();
  return (
    <View
      {...props}
      style={[
        {
          backgroundColor: t.colors.surface.primary,
          borderRadius: t.borderRadius.lg,
          padding: t.spacing[4],
          gap: t.spacing[3],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function ToneBadge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: Tone;
}) {
  const t = useAppTheme(),
    accent = useTone(tone);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        borderRadius: t.borderRadius.full,
        paddingHorizontal: t.spacing[2],
        paddingVertical: t.spacing[1],
        backgroundColor: accent + '26',
      }}
    >
      <Typography role="tiny" style={{ color: accent }}>
        {label}
      </Typography>
    </View>
  );
}
export const InfoChip = ToneBadge;

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  const t = useAppTheme();
  return (
    <View style={{ gap: t.spacing[2] }}>
      {eyebrow && (
        <Typography role="eyebrow" muted>
          {eyebrow}
        </Typography>
      )}
      <Typography role="headline" accessibilityRole="header">
        {title}
      </Typography>
      {description && <Typography muted>{description}</Typography>}
      {actions && (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing[2] }}
        >
          {actions}
        </View>
      )}
    </View>
  );
}

export function MetricCard({
  label,
  value,
  description,
  icon,
  tone = 'default',
  size = 'comfortable',
}: {
  label: string;
  value: string;
  description?: string;
  icon?: React.ReactNode;
  tone?: Tone;
  size?: 'compact' | 'comfortable';
}) {
  const t = useAppTheme(),
    accent = useTone(tone);
  return (
    <Surface
      style={{
        padding: size === 'compact' ? t.spacing[2.5] : t.spacing[4],
        borderRadius:
          size === 'compact' ? t.borderRadius.md : t.borderRadius.lg,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: t.spacing[2],
        }}
      >
        <Typography role="eyebrow" muted style={{ flexShrink: 1 }}>
          {label}
        </Typography>
        {icon}
      </View>
      <Typography
        role={size === 'compact' ? 'title' : 'headline'}
        style={{ color: accent, fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Typography>
      {description && (
        <Typography role="caption" muted>
          {description}
        </Typography>
      )}
    </Surface>
  );
}

export interface SummaryRow {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  mono?: boolean;
  tone?: Tone;
}
function SummaryItem({ row }: { row: SummaryRow }) {
  const t = useAppTheme(),
    accent = useTone(row.tone);
  return (
    <View
      accessible
      accessibilityLabel={`${row.label}: ${row.value}${row.hint ? `. ${row.hint}` : ''}`}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.spacing[3],
        padding: t.spacing[3],
        backgroundColor: t.colors.surface.secondary,
        borderRadius: t.borderRadius.md,
      }}
    >
      <Typography role="caption" muted>
        {row.label}
      </Typography>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
        <Typography
          mono={row.mono}
          selectable
          style={{
            color: accent,
            fontFamily: row.mono
              ? t.typography.fontFamily.mono
              : row.emphasis
                ? t.typography.fontFamily.bold
                : t.typography.fontFamily.medium,
            fontVariant: ['tabular-nums'],
          }}
        >
          {row.value}
        </Typography>
        {row.hint && (
          <Typography role="tiny" muted>
            {row.hint}
          </Typography>
        )}
      </View>
    </View>
  );
}
export function SummaryRows({ rows }: { rows: SummaryRow[] }) {
  const t = useAppTheme();
  return (
    <View style={{ gap: t.spacing[1.5] }}>
      {rows.map((row, i) => (
        <SummaryItem key={`${row.label}-${i}`} row={row} />
      ))}
    </View>
  );
}

export function Avatar({
  name,
  uri,
  size = 40,
}: {
  name: string;
  uri?: string;
  size?: number;
}) {
  const t = useAppTheme();
  const [failedUri, setFailedUri] = useState<string>();
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: t.borderRadius.full,
        backgroundColor: t.colors.surface.elevated,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri && failedUri !== uri ? (
        <Image
          source={{ uri }}
          onError={() => setFailedUri(uri)}
          style={{ width: size, height: size }}
        />
      ) : (
        <Typography>
          {name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((n) => Array.from(n)[0])
            .join('')
            .toUpperCase() || '?'}
        </Typography>
      )}
    </View>
  );
}

/** Native field: the visible label is also the input's accessible name. */
export function FormField({
  label,
  hint,
  error,
  style,
  ...props
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const t = useAppTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: t.spacing[1.5] }}>
      <Typography role="caption">{label}</Typography>
      <TextInput
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        accessibilityLabel={props.accessibilityLabel ?? label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={t.colors.text.secondary}
        style={[
          t.components.input.default,
          {
            color: t.colors.text.primary,
            borderColor: error
              ? t.colors.error[500]
              : focused
                ? t.colors.border.focus
                : t.colors.border.medium,
            minHeight: 44,
          },
          style,
        ]}
      />
      {!!(error || hint) && (
        <Typography
          role="caption"
          accessibilityLiveRegion="polite"
          style={{
            color: error ? t.colors.error[500] : t.colors.text.secondary,
          }}
        >
          {error || hint}
        </Typography>
      )}
    </View>
  );
}

export function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useAppTheme();
  return (
    <View style={{ gap: t.spacing[2] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Typography>
          {title} {open ? '−' : '+'}
        </Typography>
      </Pressable>
      {open && children}
    </View>
  );
}
export function Copyable({ value, label }: { value: string; label?: string }) {
  const t = useAppTheme();
  return (
    <View style={{ gap: t.spacing[2] }}>
      <Typography mono selectable>
        {value}
      </Typography>
      <CopyButton value={value} label={label ?? 'Copy'} />
    </View>
  );
}
export function CodeBlock({
  code,
  label = 'Copy code',
}: {
  code: string;
  label?: string;
}) {
  return (
    <Surface>
      <Copyable value={code} label={label} />
    </Surface>
  );
}
