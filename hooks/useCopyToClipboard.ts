import { useCallback, useEffect, useRef, useState } from 'react';
import { Clipboard } from 'react-native';

/** General copy affordance. Secret export flows must keep using sensitiveClipboard. */
export function useCopyToClipboard(value: string) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    generation.current++;
    setState('idle');
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [value]);
  const copy = useCallback(async () => {
    const revision = ++generation.current;
    clearTimeout(timer.current);
    try {
      await Clipboard.setString(value);
      if (generation.current !== revision) return false;
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 1600);
      return true;
    } catch {
      if (generation.current === revision) setState('error');
      return false;
    }
  }, [value]);
  return { state, copy };
}
