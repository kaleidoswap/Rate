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
      primary: k.bgDark,         // #102217
      secondary: k.surfaceDark,  // #162E21
      tertiary: k.surfaceHighlight, // #243E30
      modal: k.surfaceDark,
      backdrop: 'rgba(0, 0, 0, 0.7)',
    },

    text: {
      primary: k.textPrimary,    // #FFFFFF
      secondary: k.textSecondary, // #92C9A8
      tertiary: '#6B8F7A',
      inverse: k.primaryFg,      // #102217
      inverseSecondary: k.surfaceHighlight,
      disabled: '#3D5A4A',
      link: k.primary,           // #2BEE79
    },

    surface: {
      primary: k.surfaceDark,    // #162E21
      secondary: k.surfaceHighlight, // #243E30
      tertiary: k.surfaceBorder, // #244A35
      elevated: k.surfaceHighlight,
      highlight: '#1A3D28',
    },

    border: {
      light: k.surfaceHighlight, // #243E30
      medium: k.surfaceBorder,   // #244A35
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
        backgroundColor: k.surfaceHighlight, // #243E30
        borderColor: k.surfaceBorder,        // #244A35
      },
      ghost: {
        ...lightTheme.components.button.ghost,
        backgroundColor: 'transparent',
      },
    },
    card: {
      default: {
        ...lightTheme.components.card.default,
        backgroundColor: k.surfaceDark,  // #162E21
        shadowColor: '#000000',
        shadowOpacity: 0.3,
      },
      elevated: {
        ...lightTheme.components.card.elevated,
        backgroundColor: k.surfaceHighlight, // #243E30
        shadowColor: '#000000',
        shadowOpacity: 0.4,
      },
    },
    input: {
      default: {
        ...lightTheme.components.input.default,
        backgroundColor: k.surfaceHighlight, // #243E30
        borderColor: k.surfaceBorder,        // #244A35
      },
      focused: {
        borderColor: k.primary,   // #2BEE79
        backgroundColor: k.surfaceDark, // #162E21
      },
    },
  },
};
