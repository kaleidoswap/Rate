// utils/feedback.ts
//
// Multi-modal interaction feedback: fires a haptic AND a UI sound for the same
// semantic event, so the wallet stays legible through touch and hearing — not
// sight alone. This is the accessibility win (and it just feels good): a confirmed
// payment buzzes *and* chimes.
//
// Prefer these over calling `haptic.*` directly at interaction points. Haptics
// always fire (cheap, silent); sounds are gated by the user's "Sound effects"
// setting inside the sound engine, so a single call here does the right thing.
//
// Keep the audio in sync with the Redux setting by calling syncSoundSetting()
// whenever it changes (see store wiring / SettingsScreen).

import { haptic } from './haptics';
import { soundEngine } from '../services/sounds';

/** Push the persisted "Sound effects" preference into the sound engine. */
export function syncSoundSetting(enabled: boolean): void {
  soundEngine.setEnabled(enabled);
}

/** Warm up the most common sounds (call once after the app mounts). */
export function preloadFeedback(): void {
  void soundEngine.preload(['tap', 'success', 'error', 'receive']);
}

export const feedback = {
  /** Light press — button tap, navigation. */
  tap: () => {
    void haptic.light();
    void soundEngine.play('tap');
  },

  /** Selection tick — toggle, picker, route choice. */
  select: () => {
    void haptic.selection();
    void soundEngine.play('select');
  },

  /** Generic success — invoice created, action completed. */
  success: () => {
    void haptic.success();
    void soundEngine.play('success');
  },

  /** Failure — payment failed, validation error. */
  error: () => {
    void haptic.error();
    void soundEngine.play('error');
  },

  /** Caution — quote expiring, low balance. */
  warning: () => {
    void haptic.warning();
    void soundEngine.play('warning');
  },

  /** Payment sent — value leaving the wallet. */
  send: () => {
    void haptic.success();
    void soundEngine.play('send');
  },

  /** Payment received — the "coin" chime. */
  receive: () => {
    void haptic.success();
    void soundEngine.play('receive');
  },

  /** Swap completed. */
  swap: () => {
    void haptic.success();
    void soundEngine.play('swap');
  },
};
