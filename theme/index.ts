// theme/index.ts
export const theme = {
  colors: {
    // Primary brand colors with gradients
    primary: {
      50: '#EFF6FF',
      100: '#DBEAFE',
      500: '#3B82F6',
      600: '#2563EB',
      700: '#1D4ED8',
      900: '#1E3A8A',
      gradient: ['#667eea', '#764ba2'],
    },
    
    // Secondary colors for accents
    secondary: {
      50: '#F0FDF4',
      100: '#DCFCE7',
      500: '#22C55E',
      600: '#16A34A',
      700: '#15803D',
      gradient: ['#56ab2f', '#a8e6cf'],
    },
    
    // Status colors
    success: {
      50: '#ECFDF5',
      500: '#10B981',
      600: '#059669',
      gradient: ['#56ab2f', '#a8e6cf'],
    },
    
    warning: {
      50: '#FFFBEB',
      500: '#F59E0B',
      600: '#D97706',
      gradient: ['#f093fb', '#f5576c'],
    },
    
    error: {
      50: '#FEF2F2',
      500: '#EF4444',
      600: '#DC2626',
      gradient: ['#ff6b6b', '#ee5a24'],
    },
    
    // Neutral colors
    gray: {
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      400: '#9CA3AF',
      500: '#6B7280',
      600: '#4B5563',
      700: '#374151',
      800: '#1F2937',
      900: '#111827',
    },
    
    // Background colors
    background: {
      primary: '#FFFFFF',
      secondary: '#F8FAFC',
      tertiary: '#F1F5F9',
      dark: '#0F172A',
      darkSecondary: '#1E293B',
    },
    
    // Text colors
    text: {
      primary: '#0F172A',
      secondary: '#475569',
      tertiary: '#64748B',
      inverse: '#FFFFFF',
      muted: '#94A3B8',
    },
    
    // Card and surface colors
    surface: {
      primary: '#FFFFFF',
      secondary: '#F8FAFC',
      elevated: '#FFFFFF',
      overlay: 'rgba(0, 0, 0, 0.5)',
    },
    
    // Border colors
    border: {
      light: '#E2E8F0',
      medium: '#CBD5E1',
      dark: '#475569',
    },
  },
  
  typography: {
    fontFamily: {
      regular: 'System',
      medium: 'System',
      semibold: 'System',
      bold: 'System',
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
      tight: 1.25,
      snug: 1.375,
      normal: 1.5,
      relaxed: 1.625,
      loose: 2,
    },
    
    fontWeight: {
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
    },
  },
  
  spacing: {
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
    20: 80,
    24: 96,
  },
  
  borderRadius: {
    none: 0,
    sm: 4,
    base: 8,
    md: 12,
    lg: 16,
    xl: 20,
    '2xl': 24,
    full: 9999,
  },
  
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 2,
    },
    base: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 3,
      elevation: 3,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 6,
      elevation: 6,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.15,
      shadowRadius: 15,
      elevation: 15,
    },
    xl: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 20 },
      shadowOpacity: 0.25,
      shadowRadius: 25,
      elevation: 25,
    },
  },
  
  components: {
    button: {
      primary: {
        backgroundColor: '#3B82F6',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 24,
      },
      secondary: {
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderWidth: 1,
        borderColor: '#E2E8F0',
      },
      ghost: {
        backgroundColor: 'transparent',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 24,
      },
    },
    
    card: {
      default: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
      },
      elevated: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 8,
      },
    },
    
    input: {
      default: {
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        fontSize: 16,
      },
      focused: {
        borderColor: '#3B82F6',
        backgroundColor: '#FFFFFF',
      },
    },
  },
};

export type Theme = typeof theme; 