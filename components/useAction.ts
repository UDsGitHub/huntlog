import { useRef, useState } from 'react';

/**
 * Runs a sheet's action once at a time (a ref, so a double activation before React re-renders
 * can't start it twice), showing a failure in the sheet. `reset` forgets the error, for when the
 * sheet closes; a still-running attempt that then fails reports through `onOrphanedError` (a
 * toast), since the sheet that would say whether the data is gone has closed (e.g. a capture
 * switched tabs mid-delete).
 */
export function useAction(onOrphanedError: (message: string) => void) {
  const running = useRef(false);
  const attempt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(
    action: () => Promise<boolean>,
    describe: (cause: unknown) => string,
  ): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    const mine = ++attempt.current;
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      console.error(cause);
      if (mine === attempt.current) setError(describe(cause));
      else onOrphanedError(describe(cause));
      return false;
    } finally {
      running.current = false;
      if (mine === attempt.current) setBusy(false);
    }
  }
  function reset() {
    attempt.current++;
    running.current = false;
    setBusy(false);
    setError(null);
  }
  return { busy, error, run, reset };
}
