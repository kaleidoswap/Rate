// theme/index.ts
//
// Single source of truth: leaf values are sourced from the shared `kaleido-ui`
// design tokens wherever a canonical token exists, so this app stays visually
// in sync with the web (rate-extension) and any other KaleidoSwap surface.
// `k` is the flat web-facing palette (brand/intent colors, text/border ladders);
// `kdDark` is the runtime dark palette (`makeTheme`) whose surface/text/border
// values are the RN-shaped twins the web mirrors. Only genuinely app-specific
// values (shade ramps, per-protocol/per-network leg colors) remain as literals
// below — those are flagged as candidates to promote into kaleido-ui.
import { colors as k, makeTheme } from '@kaleidorg/kaleido-ui/tokens'

/** Resolved dark palette from the shared design system (brand default). */
const kdDark = makeTheme('dark')

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
    muted: string;
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
  // App-specific brand accents (not part of the kaleido-ui token set). Used for
  // per-protocol tinting of badges, balance breakdowns and action tiles. Prefer
  // the `protocolColor()` / `protocolTint()` helpers over reading these directly.
  protocol: {
    rgb: string;
    spark: string;
    arkade: string;
  };
  brand: {
    violet: string;
  };
  // Per-network "leg" colors used to colour-code Send/Receive destinations and
  // the multi-network QR breakdown. Broader than `protocol` — note `rgb` here is
  // the pink RGB-asset leg (USD aggregator), NOT the green RGB-Lightning accent
  // in `protocol.rgb`. `bitcoin` is an alias for `onchain`.
  networks: {
    onchain: string;
    bitcoin: string;
    lightning: string;
    spark: string;
    arkade: string;
    liquid: string;
    rgb: string;
    unified: string;
  };
  // Per-network chip background + readable text, sourced from kaleido-ui so
  // Send/Receive/activity chips stay contrast-safe and match the web exactly.
  networkChip: {
    bitcoin: string;
    rgb: string;
    arkade: string;
    spark: string;
    lightning: string;
    liquid: string;
  };
  networkText: {
    bitcoin: string;
    rgb: string;
    arkade: string;
    spark: string;
    lightning: string;
    liquid: string;
  };
  // Transaction-direction colors (shared with web) — used by the activity feed.
  tx: {
    sent: string;
    receive: string;
    swap: string;
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

export const lightTheme: ThemeType = {
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
      600: '#1FA855',  // #1FA855
      700: '#15803D',
      800: '#166534',
      900: '#14532D',
      950: k.primaryFg,    // #051B10
      // Flat fill per DESIGN.md: "the brand green is a flat #2BEE79 signal,
      // never a decorative gradient." Both stops are k.primary so every
      // primary-green surface (buttons, avatars, bubbles, tiles, send button)
      // renders solid. The pair shape is retained so the ~7 LinearGradient
      // consumers keep working; they can later drop the wrapper for a flat View.
      gradient: [k.primary, k.primary] as [string, string],
    },

    // Secondary: Deep Green Surfaces
    secondary: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      200: '#BBF7D0',
      300: '#86EFAC',
      400: '#4ADE80',
      500: k.textSecondary, // #92C9A8
      600: '#243E30', // #243E30
      700: '#162E21',  // #162E21
      800: '#102217',       // #102217
      900: '#0B1810', // #0B1810
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
      600: '#1FA855',  // #1FA855
      700: '#15803D',
      gradient: [k.success, '#4ADE80'] as [string, string],
    },

    warning: {
      50: '#FFFBEB',
      100: '#FEF3C7',
      500: k.warning,      // #FACC15
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
      500: k.danger,       // #F94040 — canonical danger token (k.error is a deprecated hsl alias)
      600: '#DC2626',
      700: '#B91C1C',
      gradient: [k.danger, '#F87171'] as [string, string],
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
      primary: '#F6F8F7',   // #F6F8F7
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
      muted: '#6B8F7A',
      inverse: '#FFFFFF',
      inverseSecondary: '#E2E8F0',
      disabled: '#A3B8AC',
      link: '#1FA855',   // #1FA855
    },

    // Surfaces
    surface: {
      primary: '#FFFFFF',
      secondary: '#F6F8F7', // #F6F8F7
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

    // Per-protocol accents — sourced from the shared kaleido-ui network tokens
    // so they match the web exactly (single source of truth).
    protocol: {
      rgb: k.network.rgb,      // #DD352E
      spark: k.network.spark,  // #FF6D00
      arkade: k.network.arkade, // #7C3AED
    },
    brand: {
      violet: kdDark.violet, // #6F32FF — secondary brand accent (Swap action tile)
    },
    // Per-network "leg" colors — all sourced from kaleido-ui tokens. `onchain`
    // is an alias for `bitcoin`; `unified` (all-networks) stays the brand green.
    networks: {
      onchain: k.network.bitcoin,
      bitcoin: k.network.bitcoin,     // #F7931A
      lightning: k.network.lightning, // #F6C343
      spark: k.network.spark,         // #FF6D00
      arkade: k.network.arkade,       // #7C3AED
      liquid: k.network.liquid,       // #22e1c9
      rgb: k.network.rgb,             // #DD352E
      unified: k.primary,             // #2BEE79 — all-networks brand green
    },
    networkChip: { ...k.networkChip },
    networkText: { ...k.networkText },
    tx: { ...k.tx },
  },

  typography: {
    fontFamily: {
      // Satoshi brand typeface, shipped + loaded via kaleido-ui (see App.tsx).
      // No dedicated 600 face ships, so semibold maps onto the bold cut.
      regular: 'Satoshi-Regular',
      medium: 'Satoshi-Medium',
      semibold: 'Satoshi-Bold',
      bold: 'Satoshi-Bold',
      mono: 'System', // Satoshi isn't monospaced; keep system for tabular numerics
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

/**
 * Dark theme — KaleidoSwap's brand-default. Built from the light theme with
 * dark-blue (navy) surfaces, white-on-dark text and darker shadows/components.
 */
export const darkTheme: ThemeType = {
  ...lightTheme,
  dark: true,
  colors: {
    ...lightTheme.colors,
    // Override the lightest tint shades (used app-wide as subtle "tinted
    // surface" backgrounds) so they read as dark tints instead of bright
    // patches on the dark canvas. Mid/strong shades (text/icon) stay as-is.
    primary: { ...lightTheme.colors.primary, 50: 'rgba(43, 238, 121, 0.12)', 100: 'rgba(43, 238, 121, 0.18)' },
    secondary: { ...lightTheme.colors.secondary, 50: 'rgba(111, 50, 255, 0.14)', 100: 'rgba(111, 50, 255, 0.20)' },
    accent: { ...lightTheme.colors.accent, 50: 'rgba(111, 50, 255, 0.14)', 100: 'rgba(111, 50, 255, 0.20)' },
    success: { ...lightTheme.colors.success, 50: 'rgba(43, 238, 121, 0.12)', 100: 'rgba(43, 238, 121, 0.18)' },
    warning: { ...lightTheme.colors.warning, 50: 'rgba(250, 204, 21, 0.12)', 100: 'rgba(250, 204, 21, 0.18)' },
    error: { ...lightTheme.colors.error, 50: 'rgba(249, 64, 64, 0.12)', 100: 'rgba(249, 64, 64, 0.18)' },
    info: { ...lightTheme.colors.info, 50: 'rgba(66, 144, 255, 0.12)', 100: 'rgba(66, 144, 255, 0.18)' },
    gray: { ...lightTheme.colors.gray, 50: '#0F1C33', 100: '#11203B', 200: '#18294C', 300: '#20335C' },
    background: {
      primary: kdDark.background,    // #0A1326
      secondary: '#0C1730',          // app-local mid-tone (no shared token)
      tertiary: '#11203B',           // app-local mid-tone (no shared token)
      modal: kdDark.card,            // #0F1C33
      backdrop: kdDark.surface.scrim, // rgba(0, 0, 0, 0.70)
    },
    text: {
      primary: kdDark.text.primary,     // #FFFFFF
      secondary: kdDark.text.secondary, // rgba(255,255,255,0.64)
      tertiary: k.text.muted,           // rgba(255,255,255,0.45)
      muted: kdDark.text.muted,         // rgba(255,255,255,0.42)
      inverse: '#0A1326',               // dark text for use on light fills
      inverseSecondary: '#11203B',
      disabled: kdDark.text.disabled,   // rgba(255,255,255,0.26)
      link: k.primary,
    },
    surface: {
      primary: kdDark.card,          // #0F1C33
      secondary: '#11203B',          // app-local (no shared token)
      tertiary: '#18294C',           // app-local (no shared token)
      elevated: kdDark.cardElevated, // #16273F
      highlight: '#17315A',          // app-local tinted-green highlight
    },
    border: {
      light: kdDark.border.subtle,   // rgba(255,255,255,0.06)
      medium: kdDark.border.default, // rgba(255,255,255,0.10)
      dark: kdDark.border.strong,    // rgba(255,255,255,0.16)
      focus: k.primary,
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
    ...lightTheme.components,
    button: {
      ...lightTheme.components.button,
      secondary: { ...lightTheme.components.button.secondary, backgroundColor: '#18294C', borderColor: 'rgba(255,255,255,0.10)' },
      ghost: { ...lightTheme.components.button.ghost, backgroundColor: 'transparent' },
    },
    card: {
      ...lightTheme.components.card,
      default: { ...lightTheme.components.card.default, backgroundColor: '#0F1C33', shadowColor: '#000000', shadowOpacity: 0.3 },
      elevated: { ...lightTheme.components.card.elevated, backgroundColor: '#16273F', shadowColor: '#000000', shadowOpacity: 0.4 },
    },
    input: {
      ...lightTheme.components.input,
      default: { ...lightTheme.components.input.default, backgroundColor: '#11203B', borderColor: 'rgba(255,255,255,0.10)' },
      focused: { borderColor: k.primary, backgroundColor: '#0F1C33' },
    },
  },
};

/**
 * The active app theme. Dark is the brand default ("dark backgrounds anchor
 * everything"). The 43 screens that import `theme` statically pick this up.
 * Light mode is available as `lightTheme` for the hook-based toggle path.
 */
export const theme: ThemeType = darkTheme;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type ProtocolKey = 'RGB' | 'SPARK' | 'ARKADE';

/** Resolve a protocol's brand accent (case-insensitive). Falls back to gray. */
export function protocolColor(p?: string | null): string {
  switch (String(p ?? '').toUpperCase()) {
    case 'RGB': return theme.colors.protocol.rgb;
    case 'SPARK': return theme.colors.protocol.spark;
    case 'ARKADE': return theme.colors.protocol.arkade;
    default: return theme.colors.gray[400];
  }
}

/** A 2-digit hex alpha suffix (00–FF) for an `alpha` in [0,1]. */
function hexAlpha(alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return a.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * A translucent tint of a protocol's accent — handy for badge/icon backgrounds.
 * Assumes the protocol colors are 6-digit hex (they are), so the alpha is just
 * appended. Default ~13% matches the prior inline `+ '20'` usage.
 */
export function protocolTint(p?: string | null, alpha = 0.13): string {
  return protocolColor(p) + hexAlpha(alpha);
}

/**
 * Convert a `typography.lineHeight` multiplier (e.g. 1.5) into the absolute
 * pixel value React Native expects, given a font size. The raw lineHeight
 * tokens are CSS-style multipliers and are NOT usable directly as RN
 * `lineHeight` (which is in px) — always go through this helper.
 */
export function leading(fontSize: number, multiplier: number = theme.typography.lineHeight.normal): number {
  return Math.round(fontSize * multiplier);
}