// theme/darkTheme.ts
import { colors as k } from '@kaleidorg/kaleido-ui/tokens';
import { theme as lightTheme, ThemeType } from './index';

export const darkTheme: ThemeType = {
  ...lightTheme,
  dark: true,
  colors: {
    ...lightTheme.colors,
    primary: { ...lightTheme.colors.primary },
    secondary: { ...lightTheme.colors.secondary },
    accent: { ...lightTheme.colors.accent },
    success: { ...lightTheme.colors.success },
    warning: { ...lightTheme.colors.warning },
    error: { ...lightTheme.colors.error },
    info: { ...lightTheme.colors.info },
    gray: { ...lightTheme.colors.gray },

    // KaleidoSwap dark green surfaces
    background: {
      primary: '#102217',         // #102217
      secondary: '#162E21',  // #162E21
      tertiary: '#243E30', // #243E30
      modal: '#162E21',
      backdrop: 'rgba(0, 0, 0, 0.7)',
    },

    text: {
      primary: k.textPrimary,    // #FFFFFF
      secondary: k.textSecondary, // #92C9A8
      tertiary: '#6B8F7A',
      muted: k.textMuted ?? '#6B8F7A',
      inverse: k.primaryFg,      // #102217
      inverseSecondary: '#243E30',
      disabled: '#3D5A4A',
      link: k.primary,           // #2BEE79
    },

    surface: {
      primary: '#162E21',    // #162E21
      secondary: '#243E30', // #243E30
      tertiary: '#244A35', // #244A35
      elevated: '#243E30',
      highlight: '#1A3D28',
    },

    border: {
      light: '#243E30', // #243E30
      medium: '#244A35',   // #244A35
      dark: '#3D5A4A',
      focus: k.primary,          // #2BEE79
    },
  },

  shadows: {
    ...lightTheme.shadows,
    sm: { ...lightTheme.shadows.sm, shadowColor: '#000000', shadowOpacity: 0.3 },
    base: { ...lightTheme.shadows.base, shadowColor: '#000000', shadowOpacity: 0.4 },
    md: { ...lightTheme.shadows.md, shadowColor: '#000000', shadowOpacity: 0.4 },
    lg: { ...lightTheme.shadows.lg, shadowColor: '#000000', shadowOpacity: 0.5 },
    xl: { ...lightTheme.shadows.xl, shadowColor: '#000000', shadowOpacity: 0.5 },
    '2xl': { ...lightTheme.shadows['2xl'], shadowColor: '#000000', shadowOpacity: 0.6 },
  },

  components: {
    button: {
      ...lightTheme.components.button,
      secondary: {
        ...lightTheme.components.button.secondary,
        backgroundColor: '#243E30', // #243E30
        borderColor: '#244A35',        // #244A35
      },
      ghost: {
        ...lightTheme.components.button.ghost,
        backgroundColor: 'transparent',
      },
    },
    card: {
      default: {
        ...lightTheme.components.card.default,
        backgroundColor: '#162E21',  // #162E21
        shadowColor: '#000000',
        shadowOpacity: 0.3,
      },
      elevated: {
        ...lightTheme.components.card.elevated,
        backgroundColor: '#243E30', // #243E30
        shadowColor: '#000000',
        shadowOpacity: 0.4,
      },
    },
    input: {
      default: {
        ...lightTheme.components.input.default,
        backgroundColor: '#243E30', // #243E30
        borderColor: '#244A35',        // #244A35
      },
      focused: {
        borderColor: k.primary,   // #2BEE79
        backgroundColor: '#162E21', // #162E21
      },
    },
  },
};
