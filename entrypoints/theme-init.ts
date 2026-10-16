import { applyTheme, readMirroredTheme } from '@/lib/theme';

/**
 * Loaded as a classic script in each extension page's <head>, so the theme is set before the
 * first paint. MV3's content security policy forbids inline scripts, hence a file of its own
 * (spec §9). The page's own code then follows the stored setting (`useTheme`).
 */
export default defineUnlistedScript(() => {
  applyTheme(readMirroredTheme());
});
