import { useEffect, useState } from 'react';
import { msUntilNextDay, todayLocal } from '@/lib/dates';

/**
 * Today's local date, kept current: a panel left open overnight moves This week, the Custom
 * limit and every "today"-based range on at midnight, with no data change to trigger it.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => todayLocal());
  useEffect(() => {
    // Re-checked rather than trusted: a timer can fire a little early, or late after sleep.
    const check = () => {
      if (todayLocal() !== today) setToday(todayLocal());
      else schedule();
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(check, msUntilNextDay() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [today]);
  return today;
}
