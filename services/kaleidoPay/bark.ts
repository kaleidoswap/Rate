import type { Network } from '@universal-bolt12/universal-code';
import { createElectrumSwapAccount } from './electrumSwapAccount';
import { registerKaleidoPayAccount } from './index';
import type { PayAccount } from './index';
import { lightningPayerFrom } from './lightningPayer';
import type { LightningSender } from './lightningPayer';
import { kaleidoPayStores } from './recovery';

let disconnect: (() => void) | null = null;
const FEE_UNAVAILABLE = 'Bark wallet fees are not included in this swap quote. A complete payment quote is not available yet.';

export function createBarkPayAccount(bark: LightningSender, network: Network): PayAccount {
  const account = createElectrumSwapAccount({
    source: { id: 'bark', rail: 'ln', network },
    payer: lightningPayerFrom(bark),
    ...kaleidoPayStores,
  });
  // The provider's invoice total excludes Bark's fees. Keep recovery available,
  // but never present that subtotal as an approved wallet debit.
  return {
    source: account.source,
    name: 'Bark',
    swaps: account.swaps,
    providerNames: account.providerNames,
    async quote() { throw new Error(FEE_UNAVAILABLE); },
    async quoteOptions(preview, route) {
      return (await account.quoteOptions!(preview, route)).map(option => ({
        id: option.id, name: option.name,
        unavailable: option.unavailable ?? FEE_UNAVAILABLE,
      }));
    },
    status: account.status,
  };
}

export function connectBarkToKaleidoPay(bark: LightningSender, network: Network): void {
  disconnect?.();
  disconnect = registerKaleidoPayAccount(createBarkPayAccount(bark, network));
}

export function disconnectBarkFromKaleidoPay(): void {
  disconnect?.();
  disconnect = null;
}
