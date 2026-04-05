export type ThemeName = 'light' | 'dark' | 'eink';

export interface Theme {
  name: ThemeName;
  colors: {
    background: string;
    surface: string;
    primary: string;
    primaryText: string;
    text: string;
    textSecondary: string;
    border: string;
    error: string;
    success: string;
    overlay: string;
  };
  typography: {
    fontSizeSmall: number;
    fontSizeBody: number;
    fontSizeLarge: number;
    fontSizeXL: number;
    fontSizeXXL: number;
    lineHeightBody: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
    full: number;
  };
  // E-ink specific: disable animations when true
  disableAnimations: boolean;
  // Larger touch targets for e-ink
  touchTargetSize: number;
}

export const lightTheme: Theme = {
  name: 'light',
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F5',
    primary: '#1A1A2E',
    primaryText: '#FFFFFF',
    text: '#1A1A1A',
    textSecondary: '#666666',
    border: '#E0E0E0',
    error: '#D32F2F',
    success: '#388E3C',
    overlay: 'rgba(0,0,0,0.5)',
  },
  typography: {
    fontSizeSmall: 12,
    fontSizeBody: 16,
    fontSizeLarge: 18,
    fontSizeXL: 22,
    fontSizeXXL: 28,
    lineHeightBody: 24,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 16,
    full: 9999,
  },
  disableAnimations: false,
  touchTargetSize: 44,
};

export const darkTheme: Theme = {
  ...lightTheme,
  name: 'dark',
  colors: {
    background: '#121212',
    surface: '#1E1E1E',
    primary: '#BB86FC',
    primaryText: '#000000',
    text: '#E0E0E0',
    textSecondary: '#A0A0A0',
    border: '#333333',
    error: '#CF6679',
    success: '#81C784',
    overlay: 'rgba(0,0,0,0.7)',
  },
};

// High-contrast black/white, no gradients, no shadows, no opacity transitions
export const einkTheme: Theme = {
  ...lightTheme,
  name: 'eink',
  colors: {
    background: '#FFFFFF',
    surface: '#F0F0F0',
    primary: '#000000',
    primaryText: '#FFFFFF',
    text: '#000000',
    textSecondary: '#333333',
    border: '#000000',
    error: '#000000',
    success: '#000000',
    overlay: 'rgba(0,0,0,0.6)',
  },
  disableAnimations: true,
  touchTargetSize: 56,
};

export const themes: Record<ThemeName, Theme> = {
  light: lightTheme,
  dark: darkTheme,
  eink: einkTheme,
};
