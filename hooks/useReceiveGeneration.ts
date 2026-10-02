import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

/** One automatic generation per request identity, never a delayed enrichment. */
export function useReceiveGeneration(key: string | null, prepare: () => void, generate: () => void, invalidate: () => void, enabled = true) {
  const callbacks = useRef({ prepare, generate, invalidate });
  callbacks.current = { prepare, generate, invalidate };
  const cancelScheduled = useRef<() => void>(() => {});
  useEffect(() => {
    if (key === null || !enabled) return;
    callbacks.current.prepare();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) timer = setTimeout(() => {
        if (!cancelled) callbacks.current.generate();
      }, 450);
    });
    const cancel = () => {
      cancelled = true;
      interaction.cancel();
      if (timer) clearTimeout(timer);
    };
    cancelScheduled.current = cancel;
    return () => { cancel(); callbacks.current.invalidate(); };
  }, [key, enabled]);
  return cancelScheduled;
}
