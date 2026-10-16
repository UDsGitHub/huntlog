import { useEffect } from 'react';
import { applyTheme, mirrorTheme } from '@/lib/theme';
import { useSettings } from './useSettings';

/**
 * Shows the stored theme (spec §4.8) and keeps it current, including changes from other windows.
 * Until settings load, the theme the head script applied from the mirror stays (no flash).
 */
export function useTheme(): void {
  const theme = useSettings()?.theme;
  useEffect(() => {
    if (!theme) return;
    mirrorTheme(theme);
    applyTheme(theme);
  }, [theme]);
}
