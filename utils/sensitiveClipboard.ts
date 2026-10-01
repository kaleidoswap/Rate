// utils/sensitiveClipboard.ts
//
// Copy a secret (recovery phrase) and wipe the clipboard after a short window,
// so it doesn't sit there for other apps / keyboards to read indefinitely.
// The clipboard is cleared unconditionally rather than compared first:
// reading it back triggers a paste prompt/banner on iOS 14+.
import { Clipboard } from 'react-native';

export const SENSITIVE_CLIPBOARD_TTL_MS = 60_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export function copySensitive(text: string, ttlMs: number = SENSITIVE_CLIPBOARD_TTL_MS): void {
  Clipboard.setString(text);
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    Clipboard.setString('');
  }, ttlMs);
}
