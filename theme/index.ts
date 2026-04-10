// theme/index.ts
import { colors as k } from '@kaleidorg/kaleido-ui/tokens'

// Define types for nested color objects
type ColorGradient = [string, string];

interface ColorShades {
  50?: string;
  100?: string;
  200?: string;
  300?: string;
  400?: string;
  500: string;
  600: string;
  700?: string;
  800?: string;
  900?: string;
  950?: string;
  gradient?: ColorGradient;
}

interface Colors {
  primary: ColorShades;
  secondary: ColorShades;
  accent: ColorShades;
  success: ColorShades;
  warning: ColorShades;
  error: ColorShades;
  info: ColorShades;
  gray: {
    [key: string]: string;
  };
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    modal: string;
    backdrop: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    inverse: string;
    inverseSecondary: string;
    disabled: string;
    link: string;
  };
  surface: {
    primary: string;
    secondary: string;
    tertiary: string;
    elevated: string;
    highlight: string;
  };
  border: {
    light: string;
    medium: string;
    dark: string;
    focus: string;
  };
}

type FontWeight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | 'normal' | 'bold';

interface Typography {
  fontFamily: {
    regular: string;
    medium: string;
    semibold: string;
    bold: string;
    mono: string;
  };
  fontSize: {
    xs: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
    '2xl': number;
    '3xl': number;
    '4xl': number;
    '5xl': number;
  };
  lineHeight: {
    none: number;
    tight: number;
    snug: number;
    normal: number;
    relaxed: number;
    loose: number;
  };
  fontWeight: {
    thin: FontWeight;
    light: FontWeight;
    normal: FontWeight;
    medium: FontWeight;
    semibold: FontWeight;
    bold: FontWeight;
    extrabold: FontWeight;
    black: FontWeight;
  };
  letterSpacing: {
    tighter: number;
    tight: number;
    normal: number;
    wide: number;
    wider: number;
    widest: number;
  };
}

interface Shadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ThemeType {
  dark: boolean;
  colors: Colors;
  typography: Typography;
  spacing: {
    [key: number]: number;
  };
  borderRadius: {
    none: number;
    sm: number;
    base: number;
    md: number;
    lg: number;
    xl: number;
    '2xl': number;
    '3xl': number;
    full: number;
  };
  shadows: {
    none: Shadow;
    sm: Shadow;
    base: Shadow;
    md: Shadow;
    lg: Shadow;
    xl: Shadow;
    '2xl': Shadow;
    inner: Shadow;
  };
  components: {
    button: {
      primary: {
        backgroundColor: string;
        borderRadius: number;
        paddingVertical: number;
        paddingHorizontal: number;
      };
      secondary: {
        backgroundColor: string;
        borderRadius: number;
        paddingVertical: number;
        paddingHorizontal: number;
        borderWidth: number;
        borderColor: string;
      };
      ghost: {
        backgroundColor: string;
        borderRadius: number;
        paddingVertical: number;
        paddingHorizontal: number;
      };
    };
    card: {
      default: {
        backgroundColor: string;
        borderRadius: number;
        padding: number;
      } & Shadow;
      elevated: {
        backgroundColor: string;
        borderRadius: number;
        padding: number;
      } & Shadow;
    };
    input: {
      default: {
        backgroundColor: string;
        borderRadius: number;
        paddingVertical: number;
        paddingHorizontal: number;
        borderWidth: number;
        borderColor: string;
        fontSize: number;
      };
      focused: {
        borderColor: string;
        backgroundColor: string;
      };
    };
  };
}

export { ColorGradient }

export const theme: ThemeType = {
  dark: false,
  colors: {
    // Primary: KaleidoSwap Green — Brand identity
    primary: {
      50: '#ECFDF5',
      100: '#D1FAE5',
      200: '#A7F3D0',
      300: '#6EE7B7',
      400: '#34D399',
      500: k.primary,      // #2BEE79
      600: k.primaryDark,  // #1FA855
      700: '#15803D',
      800: '#166534',
      900: '#14532D',
      950: k.primaryFg,    // #102217
      gradient: [k.primary, k.primaryDark] as [string, string],
    },

    // Secondary: Deep Green Surfaces
    secondary: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      200: '#BBF7D0',
      300: '#86EFAC',
      400: '#4ADE80',
      500: k.textSecondary, // #92C9A8
      600: k.surfaceHighlight, // #243E30
      700: k.surfaceDark,  // #162E21
      800: k.bgDark,       // #102217
      900: k.surfaceDarker, // #0B1810
      950: '#052E16',
      gradient: [k.primary, '#4ADE80'] as [string, string],
    },

    // Accent: KaleidoSwap Info Blue
    accent: {
      50: '#EFF6FF',
      100: '#DBEAFE',
      200: '#BFDBFE',
      300: '#93C5FD',
      400: '#60A5FA',
      500: k.info,         // #4290FF
      600: '#2563EB',
      700: '#1D4ED8',
      800: '#1E40AF',
      900: '#1E3A8A',
      950: '#172554',
      gradient: [k.info, '#60A5FA'] as [string, string],
    },

    // Status Colors — from kaleido-ui tokens
    success: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      500: k.success,      // #2BEE79
      600: k.primaryDark,  // #1FA855
      700: '#15803D',
      gradient: [k.success, '#4ADE80'] as [string, string],
    },

    warning: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      500: k.warning,      // #F59E0B
      600: '#D97706',
      700: '#B45309',
      gradient: [k.warning, '#FBBF24'] as [string, string],
    },

    error: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      200: '#FECACA',
      300: '#FCA5A5',
      400: '#F87171',
      500: k.error,        // #F94040
      600: '#DC2626',
      700: '#B91C1C',
      gradient: [k.error, '#F87171'] as [string, string],
    },

    info: {
      50: '#EFF6FF',
      100: '#DBEAFE',
      500: k.info,         // #4290FF
      600: '#2563EB',
      700: '#1D4ED8',
      gradient: [k.info, '#60A5FA'] as [string, string],
    },

    // Neutrals - Cool Grays for a modern tech feel
    gray: {
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
      950: '#020617',
    },

    // Backgrounds — KaleidoSwap light theme
    background: {
      primary: k.bgLight,   // #F6F8F7
      secondary: '#F0F5F2',
      tertiary: '#E8F0EB',
      modal: '#FFFFFF',
      backdrop: 'rgba(16, 34, 23, 0.6)',
    },

    // Text
    text: {
      primary: k.primaryFg, // #102217
      secondary: '#3D5A4A',
      tertiary: '#6B8F7A',
      inverse: '#FFFFFF',
      inverseSecondary: '#E2E8F0',
      disabled: '#A3B8AC',
      link: k.primaryDark,   // #1FA855
    },

    // Surfaces
    surface: {
      primary: '#FFFFFF',
      secondary: k.bgLight, // #F6F8F7
      tertiary: '#F0F5F2',
      elevated: '#FFFFFF',
      highlight: '#ECFDF5',  // Green 50
    },

    // Borders
    border: {
      light: '#E8F0EB',
      medium: '#D1E0D8',
      dark: '#A3B8AC',
      focus: k.primary,      // #2BEE79
    },
  },

  typography: {
    fontFamily: {
      regular: 'System',
      medium: 'System',
      semibold: 'System',
      bold: 'System',
      mono: 'System', // Fallback
    },

    fontSize: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 30,
      '4xl': 36,
      '5xl': 48,
    },

    lineHeight: {
      none: 1,
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    },

    fontWeight: {
      thin: '100',
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
      black: '900',
    },

    letterSpacing: {
      tighter: -0.8,
      tight: -0.4,
      normal: 0,
      wide: 0.4,
      wider: 0.8,
      widest: 1.6,
    },
  },

  spacing: {
    0: 0,
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
    12: 48,
    14: 56,
    16: 64,
    20: 80,
    24: 96,
    28: 112,
    32: 128,
    36: 144,
    40: 160,
    44: 176,
    48: 192,
    52: 208,
    56: 224,
    60: 240,
    64: 256,
    72: 288,
    80: 320,
    96: 384,
  },

  borderRadius: {
    none: 0,
    sm: 6,
    base: 10,
    md: 14,
    lg: 18,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
    full: 9999,
  },

  shadows: {
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    sm: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 2,
    },
    base: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 3,
    },
    md: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 6,
      elevation: 6,
    },
    lg: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.1,
      shadowRadius: 15,
      elevation: 10,
    },
    xl: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 20 },
      shadowOpacity: 0.1,
      shadowRadius: 25,
      elevation: 20,
    },
    '2xl': {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 25 },
      shadowOpacity: 0.15,
      shadowRadius: 50,
      elevation: 25,
    },
    inner: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 4,
      elevation: 0, // Android doesn't support inner shadows easily
    },
  },

  components: {
    button: {
      primary: {
        backgroundColor: k.primary, // #2BEE79
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 24,
      },
      secondary: {
        backgroundColor: '#F0F5F2',
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderWidth: 1,
        borderColor: '#D1E0D8',
      },
      ghost: {
        backgroundColor: 'transparent',
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 24,
      },
    },

    card: {
      default: {
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        padding: 20,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
      },
      elevated: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 24,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 8,
      },
    },

    input: {
      default: {
        backgroundColor: '#F0F5F2',
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: '#D1E0D8',
        fontSize: 16,
      },
      focused: {
        borderColor: k.primary, // #2BEE79
        backgroundColor: '#FFFFFF',
      },
    },
  },
};

// Convert our theme to @react-navigation/native theme format
export function createNavigationTheme() {
  return {
    dark: theme.dark,
    colors: {
      primary: theme.colors.primary[600],
      background: theme.colors.background.secondary,
      card: theme.colors.surface.primary,
      text: theme.colors.text.primary,
      border: theme.colors.border.light,
      notification: theme.colors.accent[500],
    },
  };
}

export type Theme = typeof theme;