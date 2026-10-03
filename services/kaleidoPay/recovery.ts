import type { SwapAttempt } from '@universal-bolt12/swap-market';
import { resumeKaleidoPaySwaps } from './electrumSwapAccount';
import { createAttemptStore, secureSecretStore } from './storage';

/** The app's one attempt store: the swap account and startup recovery must share it. */
export const kaleidoPayAttempts = createAttemptStore();
export const kaleidoPayStores = { attempts: kaleidoPayAttempts, secrets: secureSecretStore };

let running: Promise<SwapAttempt[]> | null = null;

/** Finishes swaps a restart interrupted. Never pays again; safe to call repeatedly. */
export function recoverKaleidoPaySwaps(): Promise<SwapAttempt[]> {
  running ??= resumeKaleidoPaySwaps(kaleidoPayStores).finally(() => { running = null; });
  return running;
}
