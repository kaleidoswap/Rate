// utils/gradientUtils.ts
/**
 * Utility functions for handling LinearGradient colors with proper TypeScript typing
 */

export type GradientColors = [string, string, ...string[]];

/**
 * Validates and returns properly typed gradient colors for LinearGradient component
 * @param colors - Array of color strings
 * @param fallback - Fallback colors if validation fails
 * @returns Properly typed gradient colors array
 */
export const safeGradientColors = (
  colors?: string[],
  fallback: GradientColors = ['#667eea', '#764ba2']
): GradientColors => {
  if (!colors || !Array.isArray(colors) || colors.length < 2) {
    return fallback;
  }

  // Validate that all colors are strings and not empty
  const validColors = colors.filter(
    (color): color is string => 
      typeof color === 'string' && 
      color.length > 0 && 
      (color.startsWith('#') || color.startsWith('rgb') || color.startsWith('hsl'))
  );

  if (validColors.length < 2) {
    return fallback;
  }

  // Return properly typed array
  return [validColors[0], validColors[1], ...validColors.slice(2)] as GradientColors;
};

/**
 * Common gradient color schemes used throughout the app
 */
export const gradientPresets = {
  primary: ['#4338ca', '#7c3aed'] as GradientColors,
  success: ['#10b981', '#059669'] as GradientColors,
  error: ['#ef4444', '#dc2626'] as GradientColors,
  warning: ['#f59e0b', '#d97706'] as GradientColors,
  secondary: ['#667eea', '#764ba2'] as GradientColors,
  ocean: ['#667eea', '#764ba2'] as GradientColors,
  sunset: ['#ff7e5f', '#feb47b'] as GradientColors,
  mint: ['#00b09b', '#96c93d'] as GradientColors,
} as const;

/**
 * Get gradient colors by preset name with fallback
 * @param preset - Preset name
 * @param fallback - Fallback colors
 * @returns Gradient colors array
 */
export const getGradientPreset = (
  preset: keyof typeof gradientPresets,
  fallback: GradientColors = gradientPresets.primary
): GradientColors => {
  return gradientPresets[preset] || fallback;
};