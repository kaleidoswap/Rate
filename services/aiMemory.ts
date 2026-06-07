// AsyncStorage-backed persistence for the agent's long-term memory.
//
// kaleido-mind owns the memory logic (InMemoryMemoryStore + the remember/recall
// tools); the host only injects how to persist. This keeps "what the assistant
// remembers about you" on the device, across app restarts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MemoryIO, MemoryItem } from '@kaleidorg/mind';

const KEY = 'kaleidomind.memory.v1';

export function asyncStorageMemoryIO(): MemoryIO {
  return {
    async load(): Promise<MemoryItem[]> {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as MemoryItem[]) : [];
      } catch {
        return [];
      }
    },
    async save(items: MemoryItem[]): Promise<void> {
      try {
        await AsyncStorage.setItem(KEY, JSON.stringify(items));
      } catch {
        /* best-effort — memory is a convenience, never block the agent on it */
      }
    },
  };
}
