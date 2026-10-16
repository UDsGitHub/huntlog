import { useEffect } from 'react';
import { applyTheme, mirrorTheme } from '@/lib/theme';
import { isFallbackSettings, useSettings } from './useSettings';

/**
 * Shows the stored theme (spec §4.8) and keeps it current, including changes from other windows.
 * Until settings load, the theme the head script applied from the mirror stays (no flash).
 */
export function useTheme(): void {
  const settings = useSettings();
  // After a failed read, keep what the head script showed from the mirror, rather than
  // overwriting the mirror with a default nobody chose.
  const theme = settings && !isFallbackSettings(settings) ? settings.theme : undefined;
  useEffect(() => {
    if (!theme) return;
    mirrorTheme(theme);
    applyTheme(theme);
  }, [theme]);
}
