import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Refresh deadlines on resume; hidden screens do not need ticking timers. */
export function useForegroundClock(enabled = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const update = (state: string) => {
      stop();
      if (state !== 'active') return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    update(AppState?.currentState ?? 'active');
    const subscription = AppState?.addEventListener('change', update);
    return () => { stop(); subscription?.remove(); };
  }, [enabled]);
  return now;
}
