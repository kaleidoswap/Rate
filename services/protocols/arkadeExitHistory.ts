import type { Wallet } from '@arkade-os/sdk';
/** Match official exitHistory: one row per still-owned unrolled output, never its spent ancestors. */
export async function arkadeExitHistory(wallet: Wallet): Promise<any[]> {
  const sdk = require('@arkade-os/sdk') as typeof import('@arkade-os/sdk');
  const coins = (await wallet.getVtxos({ withUnrolled: true })).filter(v => v.isUnrolled && !sdk.hasTerminalSpend(v));
  return Promise.all(coins.map(async coin => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let confirmation: { confirmed: boolean; blockTime?: number } | undefined;
    try {
      confirmation = await Promise.race([wallet.onchainProvider.getTxStatus(coin.txid), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 5000); })]);
    } catch { /* Missing chain proof remains pending. */ } finally { if (timer) clearTimeout(timer); }
    return { id: `exit:${coin.txid}:${coin.vout}`, type: 'send', status: confirmation?.confirmed ? 'confirmed' : 'pending',
      amount: coin.value, timestamp: confirmation?.blockTime ? confirmation.blockTime * 1000 : 0,
      asset: { id: 'BTC', ticker: 'BTC', precision: 0 }, protocolData: { kind: 'unilateral_exit', exitTxid: coin.txid } };
  }));
}
