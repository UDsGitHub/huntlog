import { LoaderCircleIcon } from './icons';

/**
 * Shows that work is running (an export, an import, a file being checked). It turns with a CSS
 * transform, which Chrome animates off the main thread, so it keeps turning while a big file is
 * parsed or encoded. Decorative: the text beside it says what's happening. Still under reduced
 * motion.
 */
export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <LoaderCircleIcon data-spinner="" className={`${className} motion-safe:animate-spin`} />;
}
