import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, Theme, ThemeName } from '@/constants/theme';
import { THEME_PREF_KEY } from '@/constants/config';

interface UseThemeReturn {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => Promise<void>;
}

function getDefaultTheme(): ThemeName {
  // Default to eink on Android (likely Boox), light on iOS
  return Platform.OS === 'android' ? 'eink' : 'light';
}

export function useTheme(): UseThemeReturn {
  const [themeName, setThemeName] = useState<ThemeName>(getDefaultTheme());

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREF_KEY).then((stored) => {
      if (stored && (stored === 'light' || stored === 'dark' || stored === 'eink')) {
        setThemeName(stored as ThemeName);
      }
    });
  }, []);

  const setTheme = async (name: ThemeName) => {
    setThemeName(name);
    await AsyncStorage.setItem(THEME_PREF_KEY, name);
  };

  return { theme: themes[themeName], themeName, setTheme };
}
