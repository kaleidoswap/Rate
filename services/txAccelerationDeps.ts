// services/txAccelerationDeps.ts
//
// App wiring for TxAccelerationService: mempool.space client, the KaleidoPay
// swap stores, and the Lightning wallet that pays for acceleration.

import { protocolManager } from './protocols';
import { kaleidoPayStores } from './kaleidoPay/recovery';
import { MempoolClient } from './mempool/MempoolClient';
import type { AccelerationDeps } from './TxAccelerationService';

const LIGHTNING_WALLETS = [
  { proto: 'SPARK', name: 'Spark' },
  { proto: 'RGB_LN', name: 'RGB Lightning' },
] as const;

function lightningWallet(): { adapter: any; name: string } | null {
  for (const w of LIGHTNING_WALLETS) {
    const adapter: any = protocolManager.getAdapterIfAvailable(w.proto);
    if (adapter?.isConnected()) return { adapter, name: w.name };
  }
  return null;
}

/** Name of the wallet that would pay for an acceleration, or null if none is connected. */
export function accelerationPayerName(): string | null {
  return lightningWallet()?.name ?? null;
}

export const accelerationDeps: AccelerationDeps = {
  client: network => new MempoolClient(network),
  ...kaleidoPayStores,
  async payInvoice(bolt11) {
    const w = lightningWallet();
    if (!w) throw new Error('Connect a Lightning wallet (Spark or RGB Lightning) to pay for acceleration.');
    const result = await w.adapter.sendPayment({ invoice: bolt11 });
    if (result?.status === 'failed') throw new Error(`The ${w.name} Lightning payment failed.`);
  },
};
