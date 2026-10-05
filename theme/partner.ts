import type { ThemeType } from './index';
import {
  appSemanticDark,
  appSemanticLight,
} from './kaleido-source/app-semantic';
import { typeScale } from './kaleido-source/typography';
import { radius as sourceRadius } from './kaleido-source/radius';

export {
  chartSeries,
  chartSeriesLimit,
  chartScatterSeriesLimit,
} from './kaleido-source/chart';

const radius = Object.fromEntries(
  Object.entries(sourceRadius).map(([key, value]) => [key, parseInt(value, 10)])
) as Record<keyof typeof sourceRadius, number>;

export const typeRoles = Object.fromEntries(
  Object.entries(typeScale).map(([key, value]) => [
    key,
    {
      fontSize: parseInt(value[0], 10),
      lineHeight: parseInt(value[1], 10),
    },
  ])
) as Record<keyof typeof typeScale, { fontSize: number; lineHeight: number }>;

/** Hex output keeps existing consumers that append an alpha channel compatible. */
const hex = (channels: string) =>
  '#' +
  channels
    .split(' ')
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('');

/** Preserve the app's public theme contract while using the shared slate semantics. */
export function withPartnerTokens(base: ThemeType): ThemeType {
  const channels = base.dark ? appSemanticDark : appSemanticLight;
  const c = (key: keyof typeof channels) => hex(channels[key]);
  const colors = { ...base.colors };
  for (const [name, token] of Object.entries({
    primary: 'primary',
    secondary: 'secondary',
    accent: 'secondary',
    success: 'status-success',
    warning: 'status-warning',
    error: 'status-danger',
    info: 'status-info',
  }) as [
    keyof Pick<
      typeof colors,
      | 'primary'
      | 'secondary'
      | 'accent'
      | 'success'
      | 'warning'
      | 'error'
      | 'info'
    >,
    keyof typeof channels,
  ][]) {
    const value = c(token);
    const emphasis =
      token === 'primary'
        ? c('primary-emphasis')
        : token === 'secondary'
          ? c('secondary-emphasis')
          : value;
    colors[name] = {
      ...colors[name],
      50: value + '18',
      100: value + '26',
      200: value + '44',
      300: value,
      400: value,
      500: value,
      600: emphasis,
      700: emphasis,
      800: emphasis,
      900: emphasis,
      950: emphasis,
      gradient: [value, emphasis],
    };
  }
  colors.gray = {
    ...colors.gray,
    50: c('surface-raised'),
    100: c('surface-overlay'),
    200: c('surface-elevated'),
    300: c('surface-high'),
    400: c('content-tertiary'),
  };
  colors.background = {
    primary: c('surface-base'),
    secondary: c('surface-raised'),
    tertiary: c('surface-overlay'),
    modal: c('surface-overlay'),
    backdrop: base.colors.background.backdrop,
  };
  colors.surface = {
    primary: c('surface-overlay'),
    secondary: c('surface-raised'),
    tertiary: c('surface-elevated'),
    elevated: c('surface-elevated'),
    highlight: c('surface-high'),
  };
  colors.text = {
    primary: c('content-primary'),
    secondary: c('content-secondary'),
    tertiary: c('content-tertiary'),
    muted: c('content-secondary'),
    inverse: c('primary-foreground'),
    inverseSecondary: c('content-inverse'),
    disabled: c('content-tertiary'),
    link: c('primary'),
  };
  colors.border = {
    light: c('border-subtle'),
    medium: c('border-default'),
    dark: c('divider'),
    focus: c('border-strong'),
  };
  colors.brand = { violet: c('secondary') };
  colors.networks = { ...colors.networks, unified: c('primary') };
  const borderRadius = {
    none: radius.none,
    sm: radius.sm,
    base: radius.lg,
    md: radius.xl,
    lg: radius.card,
    xl: radius.panel,
    '2xl': radius.nav,
    '3xl': radius['4xl'],
    full: radius.full,
  };
  return {
    ...base,
    colors,
    borderRadius,
    typography: {
      ...base.typography,
      fontSize: {
        xs: typeRoles.tiny.fontSize,
        sm: typeRoles.caption.fontSize,
        base: typeRoles.body.fontSize,
        lg: typeRoles.subhead.fontSize,
        xl: typeRoles.title.fontSize,
        '2xl': typeRoles.headline.fontSize,
        '3xl': typeRoles.headline.fontSize,
        '4xl': typeRoles.display.fontSize,
        '5xl': 44,
      },
    },
    components: {
      button: {
        primary: {
          ...base.components.button.primary,
          backgroundColor: colors.primary[500],
          borderRadius: radius.xl,
        },
        secondary: {
          ...base.components.button.secondary,
          backgroundColor: colors.surface.primary,
          borderColor: colors.border.light,
          borderRadius: radius.xl,
        },
        ghost: { ...base.components.button.ghost, borderRadius: radius.xl },
      },
      card: {
        default: {
          ...base.components.card.default,
          backgroundColor: colors.surface.primary,
          borderRadius: radius.card,
          padding: base.spacing[4],
          shadowOpacity: 0,
          elevation: 0,
        },
        elevated: {
          ...base.components.card.elevated,
          backgroundColor: colors.surface.elevated,
          borderRadius: radius.panel,
        },
      },
      input: {
        default: {
          ...base.components.input.default,
          backgroundColor: colors.surface.secondary,
          borderColor: colors.border.medium,
          borderRadius: radius.xl,
          fontSize: typeRoles.body.fontSize,
        },
        focused: {
          ...base.components.input.focused,
          backgroundColor: colors.surface.primary,
          borderColor: colors.border.focus,
        },
      },
    },
  };
}
