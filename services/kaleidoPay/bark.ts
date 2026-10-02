import type { Network } from '@universal-bolt12/universal-code';
import { createElectrumSwapAccount } from './electrumSwapAccount';
import { registerKaleidoPayAccount } from './index';
import { lightningPayerFrom } from './lightningPayer';
import type { LightningSender } from './lightningPayer';
import { kaleidoPayStores } from './recovery';

let disconnect: (() => void) | null = null;

/** Lets KaleidoPay pay bitcoin addresses from the Bark balance, through Electrum swap providers. */
export function connectBarkToKaleidoPay(bark: LightningSender, network: Network): void {
  disconnect?.();
  disconnect = registerKaleidoPayAccount(createElectrumSwapAccount({
    source: { id: 'bark', rail: 'ln', network },
    payer: lightningPayerFrom(bark),
    ...kaleidoPayStores,
  }));
}

export function disconnectBarkFromKaleidoPay(): void {
  disconnect?.();
  disconnect = null;
}
