/**
 * Registers each connected wallet as Send's ways to pay, on that connection's own
 * network, so every account offers only what it can actually pay. Synced before every
 * review (see syncPayAccounts). Also tells Receive which chain each account is on.
 */
import { useEffect } from 'react';
import { protocolManager, rgbAccountProtocol } from '../protocols';
import { MobileSparkAdapter } from '../protocols/MobileSparkAdapter';
import { registerKaleidoPayAccount, registerKaleidoPayPreparer } from './index';
import type { Network, RequestAsset } from './index';
import { connectSparkPayAccounts, connectedSparkTokens, registerSparkTokenPayment, type SparkToken } from './sparkPay';
import { connectRgbPayAccounts, currentRgbPayAdapter, rgbRequestAsset, registerRgbAssetPayment, type RgbPayAdapter } from './rgbPay';
import { connectRgbL1PayAccounts } from './rgbL1Pay';
import { connectArkadePayAccounts } from './arkadePay';
import { getPayOptions } from './payOptions';
import { currentBarkHost } from '../protocols/barkPreferences';
import type { ArkadeLightningReceiveOptions } from './arkadeIntents';

// RGB_L1 (RGB on this phone) connects only when no RGB node is connected, so at most one RGB wallet registers.
type PayProtocol = 'SPARK' | 'RGB_LN' | 'RGB_L1' | 'ARKADE';
const PAY_PROTOCOLS: PayProtocol[] = ['SPARK', 'RGB_LN', 'RGB_L1', 'ARKADE'];
const registered = new Map<PayProtocol, { adapter: unknown; network: Network; off: () => void }>();

/** The KaleidoSwap maker: configured with the RGB node, else an override, else the live signet maker on test chains. */
export function kaleidoswapMakerUrl(network: Network, configured?: string): string | undefined {
  if (configured) return configured;
  const override = process.env.EXPO_PUBLIC_KALEIDOSWAP_MAKER_URL;
  if (override) return override;
  return network === 'mainnet' || network === 'regtest' ? undefined : 'https://maker.signet.kaleidoswap.com';
}

const CHAINS: Network[] = ['mainnet', 'signet', 'mutinynet', 'testnet', 'regtest'];
/** A network name as SDKs report it ('bitcoin' is mainnet), or undefined when unknown. */
export function normalizeChain(raw: unknown): Network | undefined {
  const name = String(raw ?? '').toLowerCase();
  if (name === 'bitcoin') return 'mainnet';
  return CHAINS.includes(name as Network) ? name as Network : undefined;
}

/** The chain a connected wallet is on (an Arkade "signet" setting runs on the mutinynet server). */
export function adapterChain(protocol: PayProtocol | 'BARK', adapter: any): Network | undefined {
  if (protocol === 'BARK') return normalizeChain(currentBarkHost()?.network);
  if (protocol === 'ARKADE') {
    const server = String(adapter?.arkInfo?.network ?? '').toLowerCase();
    if (CHAINS.includes(server as Network)) return server as Network;
    if (/mutinynet/i.test(getPayOptions().arkServerUrl ?? '')) return 'mutinynet';
  }
  return normalizeChain(adapter?.network);
}

function register(protocol: PayProtocol, adapter: any, network: Network): () => void {
  if (protocol === 'SPARK') return connectSparkPayAccounts(adapter, network);
  if (protocol === 'RGB_LN') return connectRgbPayAccounts(adapter, network);
  if (protocol === 'RGB_L1') return connectRgbL1PayAccounts(adapter, network);
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

/** The connected RGB wallet that can read and pay RGB invoices (the node, or RGB on this phone). */
export function rgbInvoiceWallet(): RgbPayAdapter | null {
  syncPayAccounts();
  const adapter = currentRgbPayAdapter();
  return adapter?.isConnected() ? adapter : null;
}

/**
 * Reads an RGB invoice's asset through the RGB wallet and registers the per-payment
 * asset account, so the request can be planned and quoted in that asset.
 */
export async function prepareRgbRequest(invoice: string, amount?: number): Promise<RgbRequestAsset> {
  const adapter = rgbInvoiceWallet();
  if (!adapter) throw new Error('Turn on RGB in Settings, or connect your RGB node, to pay RGB invoices.');
  const asset = await rgbRequestAsset(adapter, invoice, amount);
  rgbAssetRegistration?.();
  rgbAssetRegistration = registerRgbAssetPayment({ id: asset.id, ticker: asset.ticker, precision: asset.precision });
  return asset.amount > 0 ? asset : { id: asset.id, ticker: asset.ticker, precision: asset.precision };
}

let sparkTokenRegistration: (() => void) | null = null;

/** The Spark tokens Send can pay a Spark address with (empty when Spark is not connected). */
export async function sendableSparkTokens(): Promise<SparkToken[]> {
  syncPayAccounts();
  return connectedSparkTokens().catch(() => []);
}

/**
 * Registers the per-payment Spark token account, so a Spark-address request can be quoted
 * in that token. `null` drops it again, so a bitcoin payment never lists a token option.
 */
export function prepareSparkTokenRequest(token: Pick<SparkToken, 'id' | 'ticker' | 'precision'> | null): void {
  sparkTokenRegistration?.();
  sparkTokenRegistration = token ? registerSparkTokenPayment({ id: token.id, ticker: token.ticker, precision: token.precision }) : null;
}

/** The connected Spark wallet and its chain (for sends to other chains), or null when Spark is not connected. */
export function connectedSparkWallet(): { adapter: any; network: Network | undefined } | null {
  let adapter: any;
  try { adapter = protocolManager.getAdapterIfAvailable('SPARK'); } catch { return null; }
  return adapter?.isConnected?.() ? { adapter, network: adapterChain('SPARK', adapter) } : null;
}

/** The chain a connected receive account is on, or undefined when it is not connected or can't tell. */
export function receiveAccountChain(account: 'RGB' | 'SPARK' | 'ARKADE' | 'BARK'): Network | undefined {
  const protocol = account === 'RGB' ? rgbAccountProtocol() : account;
  let adapter: any;
  try { adapter = protocolManager.getAdapterIfAvailable(protocol); } catch { return undefined; }
  return adapter?.isConnected?.() ? adapterChain(protocol, adapter) : undefined;
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
