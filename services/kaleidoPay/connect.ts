/**
 * Registers each connected wallet as Send's ways to pay. Called by the protocol
 * wiring (services/protocols/wdk.ts) when a wallet connects, with that connection's
 * own network, so every account offers only what it can actually pay.
 */
import { useEffect } from 'react';
import { protocolManager } from '../protocols';
import { MobileSparkAdapter } from '../protocols/MobileSparkAdapter';
import { registerKaleidoPayAccount, registerKaleidoPayPreparer } from './index';
import type { Network, RequestAsset } from './index';
import { connectSparkPayAccounts } from './sparkPay';
import { connectRgbPayAccounts, rgbRequestAsset, registerRgbAssetPayment } from './rgbPay';
import { connectArkadePayAccounts } from './arkadePay';
import { getPayOptions } from './payOptions';
import { currentBarkHost } from '../protocols/barkPreferences';
import type { ArkadeLightningReceiveOptions } from './arkadeIntents';
export { setPayOptions } from './payOptions';

type PayProtocol = 'SPARK' | 'RGB_LN' | 'ARKADE';
const PAY_PROTOCOLS: PayProtocol[] = ['SPARK', 'RGB_LN', 'ARKADE'];
const registered = new Map<PayProtocol, { adapter: unknown; network: Network; off: () => void }>();

/** The KaleidoSwap maker: configured with the RGB node, else an override, else the live signet maker on test chains. */
export function kaleidoswapMakerUrl(network: Network, configured?: string): string | undefined {
  if (configured) return configured;
  const override = process.env.EXPO_PUBLIC_KALEIDOSWAP_MAKER_URL;
  if (override) return override;
  return network === 'mainnet' || network === 'regtest' ? undefined : 'https://maker.signet.kaleidoswap.com';
}

const CHAINS: Network[] = ['mainnet', 'signet', 'mutinynet', 'testnet', 'regtest'];
/** The chain a connected wallet is on (an Arkade "signet" setting runs on the mutinynet server). */
export function adapterChain(protocol: PayProtocol, adapter: any): Network | undefined {
  const declared = String(adapter?.network ?? '').toLowerCase();
  const server = String(adapter?.arkInfo?.network ?? '').toLowerCase();
  if (protocol === 'ARKADE' && CHAINS.includes(server as Network)) return server as Network;
  if (protocol === 'ARKADE' && /mutinynet/i.test(getPayOptions().arkServerUrl ?? '')) return 'mutinynet';
  if (declared === 'bitcoin') return 'mainnet';
  return CHAINS.includes(declared as Network) ? declared as Network : undefined;
}

function register(protocol: PayProtocol, adapter: any, network: Network): () => void {
  if (protocol === 'SPARK') return connectSparkPayAccounts(adapter, network);
  if (protocol === 'RGB_LN') return connectRgbPayAccounts(adapter, network);
  return connectArkadePayAccounts(adapter, network, {
    makerUrl: kaleidoswapMakerUrl(network, getPayOptions().makerUrl),
    arkServerUrl: getPayOptions().arkServerUrl,
  });
}

/**
 * Brings Send's accounts in line with the wallets connected right now: a newly connected
 * (or reconnected) wallet is registered, a disconnected one is dropped. Runs before every
 * review, so connections made anywhere in the app (Settings, NWC, startup) are picked up.
 */
export function syncPayAccounts(): void {
  for (const protocol of PAY_PROTOCOLS) {
    let adapter: any;
    try { adapter = protocolManager.getAdapterIfAvailable(protocol); } catch { adapter = undefined; }
    const live = !!adapter?.isConnected?.();
    const network = live ? adapterChain(protocol, adapter) : undefined;
    const current = registered.get(protocol);
    if (current && current.adapter === adapter && current.network === network && live) continue;
    current?.off();
    registered.delete(protocol);
    if (!live || !network) continue;
    try {
      registered.set(protocol, { adapter, network, off: register(protocol, adapter, network) });
    } catch (error) {
      // A wallet that can't offer payments must not block the others.
      console.warn(`[pay] ${protocol} payment accounts unavailable:`, error);
    }
  }
}
registerKaleidoPayPreparer(async () => { syncPayAccounts(); });

/** Spark's on-chain withdrawal needs the wallet id, so Send registers it while open. */
export function usePayAccounts(walletId: number | undefined): void {
  useEffect(() => {
    if (!walletId) return;
    try {
      const adapter = protocolManager.getAdapterIfAvailable('SPARK');
      const account = adapter instanceof MobileSparkAdapter && adapter.isConnected() ? adapter.createPaymentAccount(walletId) : null;
      if (account) return registerKaleidoPayAccount(account);
    } catch { /* A disconnected wallet offers no routes. */ }
  }, [walletId]);
}

export type RgbRequestAsset = Omit<RequestAsset, 'amount'> & { amount?: number };
let rgbAssetRegistration: (() => void) | null = null;

/**
 * Reads an RGB invoice's asset through the RGB node and registers the per-payment
 * asset account, so the request can be planned and quoted in that asset.
 */
export async function prepareRgbRequest(invoice: string, amount?: number): Promise<RgbRequestAsset> {
  const adapter = protocolManager.getAdapterIfAvailable('RGB_LN') as any;
  if (!adapter?.isConnected?.()) throw new Error('Connect your RGB node to pay RGB invoices.');
  const asset = await rgbRequestAsset(adapter, invoice, amount);
  rgbAssetRegistration?.();
  rgbAssetRegistration = registerRgbAssetPayment({ id: asset.id, ticker: asset.ticker, precision: asset.precision });
  return asset.amount > 0 ? asset : { id: asset.id, ticker: asset.ticker, precision: asset.precision };
}

type ReceiveAccount = 'RGB' | 'SPARK' | 'ARKADE' | 'BARK';
const RECEIVE_PROTOCOL: Record<ReceiveAccount, string> = { RGB: 'RGB_LN', SPARK: 'SPARK', ARKADE: 'ARKADE', BARK: 'BARK' };

/** The chain a connected receive account is on, or undefined when it is not connected or can't tell. */
export function receiveAccountChain(account: ReceiveAccount): Network | undefined {
  let adapter: any;
  try { adapter = protocolManager.getAdapterIfAvailable(RECEIVE_PROTOCOL[account] as any); } catch { return undefined; }
  if (!adapter?.isConnected?.()) return undefined;
  if (account === 'BARK') {
    const network = String(currentBarkHost()?.network ?? '').toLowerCase();
    return network === 'bitcoin' ? 'mainnet' : (CHAINS.includes(network as Network) ? network as Network : undefined);
  }
  return adapterChain(account === 'RGB' ? 'RGB_LN' : account, adapter);
}

/** What a Lightning receive into the connected Arkade wallet needs, or null when Arkade is not connected. */
export function arkadeReceiveOptions(): ArkadeLightningReceiveOptions | null {
  const adapter = protocolManager.getAdapterIfAvailable('ARKADE') as any;
  if (!adapter?.isConnected?.()) return null;
  const wallet = adapter.rawWallet;
  const arkServerUrl = getPayOptions().arkServerUrl ?? wallet?.arkProvider?.serverUrl;
  const network = adapterChain('ARKADE', adapter);
  if (!wallet || !arkServerUrl || !network) return null;
  return {
    network, wallet, arkServerUrl, arkNetwork: adapter.arkInfo?.network,
    makerUrl: kaleidoswapMakerUrl(network, getPayOptions().makerUrl),
  };
}
