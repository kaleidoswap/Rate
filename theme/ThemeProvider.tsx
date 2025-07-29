// theme/ThemeProvider.tsx
import React, { createContext, useContext, ReactNode } from 'react';
import { theme as defaultTheme, ThemeType } from './index';

const ThemeContext = createContext<ThemeType>(defaultTheme);

export function useAppTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: ReactNode;
  theme?: ThemeType;
}

export function AppThemeProvider({ children, theme = defaultTheme }: ThemeProviderProps) {
  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
} 