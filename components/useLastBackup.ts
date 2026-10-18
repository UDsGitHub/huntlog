import { useEffect, useState } from 'react';
import { onLastBackupChanged, readLastBackup } from '@/lib/backup';

/**
 * When the last backup was made (undefined: never), following backups made in any window.
 * `loaded` is false until the first read, so "never" isn't shown before it's known.
 */
export function useLastBackup(): { at: string | undefined; loaded: boolean } {
  const [state, setState] = useState<{ at: string | undefined; loaded: boolean }>({
    at: undefined,
    loaded: false,
  });
  useEffect(() => {
    let active = true;
    let changed = false;
    // Listen before reading, so a backup made meanwhile isn't missed.
    const stop = onLastBackupChanged((at) => {
      changed = true;
      setState({ at, loaded: true });
    });
    void readLastBackup().then((at) => {
      if (active && !changed) setState({ at, loaded: true });
    });
    return () => {
      active = false;
      stop();
    };
  }, []);
  return state;
}
