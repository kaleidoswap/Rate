import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  streamActivity,
  type ActivityItem,
  type ActivityResult,
  type LoadActivityOptions,
} from '../services/ActivityService';

export interface ActivityFeed {
  items: ActivityItem[];
  /** Some sources are still loading. */
  updating: boolean;
  /** The last load once every source answered or timed out. */
  result: ActivityResult | null;
  /** Load again now; resolves true when every connected account answered. */
  refresh: () => Promise<boolean>;
}

/**
 * The activity list while the screen is focused: the last known items at
 * once, then each account's items as they arrive. Polls every `pollMs`,
 * skipping a tick while a load is still running.
 */
export function useActivityFeed(options: LoadActivityOptions, pollMs?: number): ActivityFeed {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [updating, setUpdating] = useState(true);
  const [result, setResult] = useState<ActivityResult | null>(null);
  const run = useRef<{ cancel: () => void; done: Promise<boolean> } | null>(null);

  const load = useCallback((restart: boolean): Promise<boolean> => {
    if (run.current && !restart) return run.current.done;
    run.current?.cancel();
    const stream = streamActivity({ ...options, useCache: true }, (p) => setItems(p.items));
    const current = {
      cancel: stream.cancel,
      done: stream.done.then(({ pending: _pending, ...settled }) => {
        if (run.current === current) {
          run.current = null;
          setResult(settled);
          setUpdating(false);
        }
        return settled.hadConnectedAdapter && settled.failedSources === 0;
      }),
    };
    run.current = current;
    setUpdating(true);
    return current.done;
  }, [options]);

  useFocusEffect(useCallback(() => {
    load(true);
    const timer = pollMs ? setInterval(() => { void load(false); }, pollMs) : undefined;
    return () => {
      clearInterval(timer);
      run.current?.cancel();
      run.current = null;
    };
  }, [load, pollMs]));

  const refresh = useCallback(() => load(true), [load]);

  return { items, updating, result, refresh };
}
