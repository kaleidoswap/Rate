import type { SwapNetwork } from './types';

export const ESPLORA: Record<SwapNetwork, string> = {
  mainnet: 'https://mempool.space/api',
  signet: 'https://mempool.space/signet/api',
  testnet: 'https://mempool.space/testnet4/api',
  mutinynet: 'https://mutinynet.com/api',
};

export class Esplora {
  constructor(private base: string) {}

  private async get(path: string): Promise<any> {
    const r = await fetch(this.base + path);
    if (!r.ok) throw new Error(`esplora ${path}: ${r.status}`);
    const type = r.headers.get('content-type') || '';
    return type.includes('json') ? r.json() : r.text();
  }

  async tipHeight(): Promise<number> {
    return Number(await this.get('/blocks/tip/height'));
  }

  /** Fee rate in sat/vB for the next block or two. */
  async feeRate(): Promise<number> {
    try {
      const r = await this.get('/v1/fees/recommended');
      return Math.max(1, r.fastestFee ?? r.halfHourFee ?? 2);
    } catch {
      const e = await this.get('/fee-estimates');
      return Math.max(1, Math.ceil(e['2'] ?? e['3'] ?? 2));
    }
  }

  /** The output paying `address` exactly `amount`, with its confirmation state. */
  async findOutput(address: string, amount: number): Promise<{ txid: string; vout: number; confirmed: boolean } | null> {
    const txs: any[] = await this.get(`/address/${address}/txs`);
    for (const tx of txs) {
      const vout = tx.vout.findIndex((o: any) => o.scriptpubkey_address === address && o.value === amount);
      if (vout >= 0) return { txid: tx.txid, vout, confirmed: !!tx.status?.confirmed };
    }
    return null;
  }

  async broadcast(hex: string): Promise<string> {
    const r = await fetch(this.base + '/tx', { method: 'POST', body: hex });
    const text = await r.text();
    if (!r.ok) throw new Error(`broadcast rejected: ${text}`);
    return text.trim();
  }
}
