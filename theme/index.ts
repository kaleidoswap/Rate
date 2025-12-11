// theme/index.ts

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
    // Primary: Deep Indigo/Violet - Modern, Trustworthy, Tech-forward
    primary: {
      50: '#EEF2FF',
      100: '#E0E7FF',
      200: '#C7D2FE',
      300: '#A5B4FC',
      400: '#818CF8',
      500: '#6366F1',
      600: '#4F46E5',
      700: '#4338CA',
      800: '#3730A3',
      900: '#312E81',
      950: '#1E1B4B',
      gradient: ['#6366F1', '#8B5CF6'], // Indigo to Violet
    },

    // Secondary: Vibrant Teal/Emerald - Growth, Success, Energy
    secondary: {
      50: '#ECFDF5',
      100: '#D1FAE5',
      200: '#A7F3D0',
      300: '#6EE7B7',
      400: '#34D399',
      500: '#10B981',
      600: '#059669',
      700: '#047857',
      800: '#065F46',
      900: '#064E3B',
      950: '#022C22',
      gradient: ['#10B981', '#34D399'],
    },

    // Accent: Hot Pink/Rose - Highlights, Actions, Excitement
    accent: {
      50: '#FDF2F8',
      100: '#FCE7F3',
      200: '#FBCFE8',
      300: '#F9A8D4',
      400: '#F472B6',
      500: '#EC4899',
      600: '#DB2777',
      700: '#BE185D',
      800: '#9D174D',
      900: '#831843',
      950: '#500724',
      gradient: ['#EC4899', '#F472B6'],
    },

    // Status Colors
    success: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      500: '#22C55E',
      600: '#16A34A',
      700: '#15803D',
      gradient: ['#22C55E', '#4ADE80'],
    },

    warning: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      500: '#F59E0B',
      600: '#D97706',
      700: '#B45309',
      gradient: ['#F59E0B', '#FBBF24'],
    },

    error: {
      50: '#FEF2F2',
      100: '#FEE2E2',
      200: '#FECACA',
      300: '#FCA5A5',
      400: '#F87171',
      500: '#EF4444',
      600: '#DC2626',
      700: '#B91C1C',
      gradient: ['#EF4444', '#F87171'],
    },

    info: {
      50: '#EFF6FF',
      100: '#DBEAFE',
      500: '#3B82F6',
      600: '#2563EB',
      700: '#1D4ED8',
      gradient: ['#3B82F6', '#60A5FA'],
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

    // Backgrounds
    background: {
      primary: '#FFFFFF',
      secondary: '#F8FAFC', // Very light gray/blue
      tertiary: '#F1F5F9',
      modal: '#FFFFFF',
      backdrop: 'rgba(15, 23, 42, 0.6)', // Slate 900 with opacity
    },

    // Text
    text: {
      primary: '#0F172A', // Slate 900
      secondary: '#475569', // Slate 600
      tertiary: '#94A3B8', // Slate 400
      inverse: '#FFFFFF',
      inverseSecondary: '#E2E8F0',
      disabled: '#CBD5E1',
      link: '#4F46E5', // Indigo 600
    },

    // Surfaces
    surface: {
      primary: '#FFFFFF',
      secondary: '#F8FAFC',
      tertiary: '#F1F5F9',
      elevated: '#FFFFFF',
      highlight: '#EEF2FF', // Indigo 50
    },

    // Borders
    border: {
      light: '#F1F5F9', // Slate 100
      medium: '#E2E8F0', // Slate 200
      dark: '#CBD5E1', // Slate 300
      focus: '#6366F1', // Indigo 500
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
        backgroundColor: '#4F46E5', // Indigo 600
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 24,
      },
      secondary: {
        backgroundColor: '#F1F5F9', // Slate 100
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderWidth: 1,
        borderColor: '#E2E8F0', // Slate 200
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
        backgroundColor: '#F8FAFC', // Slate 50
        borderRadius: 14,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0', // Slate 200
        fontSize: 16,
      },
      focused: {
        borderColor: '#6366F1', // Indigo 500
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