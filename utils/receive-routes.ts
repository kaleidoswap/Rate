/**
 * Receive routing: how a payment can arrive (the method) and which account it lands in
 * (the destination). Receive shows one method at a time; Lightning, on-chain and Ark
 * can each land in more than one account, so the user picks where it goes.
 *
 * Pure: the screen passes in what is connected and on which chain.
 */
import type { AccountId, AssetFamily } from './account-routing';

export type ReceiveMethodId = 'universal' | 'lightning' | 'onchain' | 'spark' | 'ark';
export type ReceiveChain = 'mainnet' | 'signet' | 'mutinynet' | 'testnet' | 'regtest';

/** A connected receive account and the chain it is on (undefined when it can't tell). */
export interface ReceiveAccountInfo {
  account: AccountId;
  chain?: ReceiveChain;
}

export interface ReceiveCaps {
  /** 'ln' when the RGB slot is a plain NWC Lightning wallet. */
  nwcWalletType?: 'ln' | 'rln' | null;
  nwcCapabilities?: readonly string[];
  /** Whether the RGB node has a usable channel; 'unknown' until channels load. */
  rgbChannels?: 'unknown' | 'none' | 'some';
}

export interface ReceiveDestination {
  account: AccountId;
  label: string;
  detail: string;
  chain?: ReceiveChain;
  /** The sender must be asked for a fixed amount (Bark and Arkade Lightning). */
  needsAmount: boolean;
  available: boolean;
  reason?: string;
}

const CHAIN_LABELS: Record<ReceiveChain, string> = {
  mainnet: 'Mainnet', signet: 'Signet', mutinynet: 'Mutinynet', testnet: 'Testnet', regtest: 'Regtest',
};
export const chainLabel = (chain?: ReceiveChain) => (chain ? CHAIN_LABELS[chain] : 'Unknown network');

const has = (accounts: ReceiveAccountInfo[], account: AccountId) => accounts.find(a => a.account === account);

function rgbCanInvoice(caps: ReceiveCaps): boolean {
  return caps.nwcWalletType == null || !!caps.nwcCapabilities?.includes('createInvoice');
}
/** Whether the RGB slot can give a bitcoin address (a plain NWC Lightning wallet can't). */
export function rgbCanReceiveOnchain(caps: ReceiveCaps): boolean {
  return caps.nwcWalletType !== 'ln' && (caps.nwcWalletType == null || !!caps.nwcCapabilities?.includes('onchain'));
}
export function rgbAccountLabel(caps: ReceiveCaps): string {
  return caps.nwcWalletType === 'ln' ? 'Lightning wallet' : 'RGB Lightning node';
}
/** An account's name as Receive shows it. */
export function accountLabel(account: AccountId, caps: ReceiveCaps): string {
  return account === 'RGB' ? rgbAccountLabel(caps) : account === 'SPARK' ? 'Spark' : account === 'ARKADE' ? 'Arkade' : 'Bark';
}

/** Accounts a Lightning payment can land in, best first. */
export function lightningDestinations(accounts: ReceiveAccountInfo[], caps: ReceiveCaps): ReceiveDestination[] {
  const out: ReceiveDestination[] = [];
  const rgb = has(accounts, 'RGB');
  if (rgb) {
    const invoice = rgbCanInvoice(caps);
    const noChannel = caps.nwcWalletType !== 'ln' && caps.rgbChannels === 'none';
    out.push({
      account: 'RGB', label: rgbAccountLabel(caps), chain: rgb.chain, needsAmount: false,
      detail: caps.nwcWalletType === 'ln' ? 'Connected over NWC' : 'Your channels',
      available: invoice && !noChannel,
      reason: !invoice ? 'This wallet does not allow creating invoices.' : noChannel ? 'No open channel to receive into.' : undefined,
    });
  }
  const spark = has(accounts, 'SPARK');
  if (spark) out.push({ account: 'SPARK', label: 'Spark', chain: spark.chain, needsAmount: false, detail: 'Lands in your Spark balance', available: true });
  const bark = has(accounts, 'BARK');
  if (bark) out.push({ account: 'BARK', label: 'Bark', chain: bark.chain, needsAmount: true, detail: 'Lands in your Bark balance · needs an amount', available: true });
  const arkade = has(accounts, 'ARKADE');
  if (arkade) {
    out.push({
      account: 'ARKADE', label: 'Arkade', chain: arkade.chain, needsAmount: true,
      detail: 'Through a swap provider · needs an amount · the sender pays the swap fee', available: true,
    });
  }
  return out;
}

/** Accounts an on-chain bitcoin payment can land in, best first. */
export function onchainDestinations(accounts: ReceiveAccountInfo[], caps: ReceiveCaps): ReceiveDestination[] {
  const out: ReceiveDestination[] = [];
  const rgb = has(accounts, 'RGB');
  if (rgb && rgbCanReceiveOnchain(caps)) {
    out.push({ account: 'RGB', label: rgbAccountLabel(caps), chain: rgb.chain, needsAmount: false, detail: 'Your node’s bitcoin wallet', available: true });
  }
  const spark = has(accounts, 'SPARK');
  if (spark) out.push({ account: 'SPARK', label: 'Spark', chain: spark.chain, needsAmount: false, detail: 'Claimed into Spark after it confirms', available: true });
  const arkade = has(accounts, 'ARKADE');
  if (arkade) out.push({ account: 'ARKADE', label: 'Arkade', chain: arkade.chain, needsAmount: false, detail: 'Boarded into Arkade after it confirms', available: true });
  const bark = has(accounts, 'BARK');
  if (bark) out.push({ account: 'BARK', label: 'Bark', chain: bark.chain, needsAmount: false, detail: 'Bark’s on-chain wallet, then board it into Bark', available: true });
  return out;
}

/** Accounts an Ark payment can land in (each has its own Ark server). */
export function arkDestinations(accounts: ReceiveAccountInfo[]): ReceiveDestination[] {
  const out: ReceiveDestination[] = [];
  const arkade = has(accounts, 'ARKADE');
  if (arkade) out.push({ account: 'ARKADE', label: 'Arkade', chain: arkade.chain, needsAmount: false, detail: 'Your Arkade address', available: true });
  const bark = has(accounts, 'BARK');
  if (bark) out.push({ account: 'BARK', label: 'Bark', chain: bark.chain, needsAmount: false, detail: 'Your Bark address', available: true });
  return out;
}

export function destinationsFor(
  method: ReceiveMethodId, accounts: ReceiveAccountInfo[], caps: ReceiveCaps, family: AssetFamily | 'USD' = 'BTC',
): ReceiveDestination[] {
  // An RGB asset only ever lands in the RGB node, on-chain or over its channels.
  if (family === 'RGB') {
    const rgb = has(accounts, 'RGB');
    return rgb ? [{
      account: 'RGB', label: rgbAccountLabel(caps), chain: rgb.chain, needsAmount: false, available: true,
      detail: method === 'lightning' ? 'Your RGB channels' : 'Your RGB wallet',
    }] : [];
  }
  if (method === 'lightning') return lightningDestinations(accounts, caps);
  if (method === 'onchain') return onchainDestinations(accounts, caps);
  if (method === 'ark') return arkDestinations(accounts);
  if (method === 'spark') {
    const spark = has(accounts, 'SPARK');
    return spark ? [{ account: 'SPARK', label: 'Spark', chain: spark.chain, needsAmount: false, detail: 'Your Spark address', available: true }] : [];
  }
  return [];
}

/** The ways to receive the selected asset, in display order. */
export function methodsFor(family: AssetFamily | 'USD', accounts: ReceiveAccountInfo[], caps: ReceiveCaps): ReceiveMethodId[] {
  if (family === 'USD') return ['universal'];
  if (family === 'RGB') {
    if (!has(accounts, 'RGB')) return [];
    return caps.rgbChannels === 'none' ? ['onchain'] : ['onchain', 'lightning'];
  }
  if (family !== 'BTC') return [];
  const methods: ReceiveMethodId[] = ['universal'];
  if (lightningDestinations(accounts, caps).some(d => d.available)) methods.push('lightning');
  if (onchainDestinations(accounts, caps).length) methods.push('onchain');
  if (has(accounts, 'SPARK')) methods.push('spark');
  if (arkDestinations(accounts).length) methods.push('ark');
  return methods.length > 1 ? methods : [];
}

/** The first usable destination, or the remembered one when it is still usable. */
export function defaultDestination(options: ReceiveDestination[], preferred?: AccountId | null, amountSats = 0): AccountId | null {
  const usable = (d: ReceiveDestination) => d.available && (!d.needsAmount || amountSats > 0);
  const remembered = options.find(d => d.account === preferred && d.available);
  if (remembered) return remembered.account;
  return (options.find(usable) ?? options.find(d => d.available))?.account ?? null;
}

// ---------------------------------------------------------------------------
// The screen's request generators still speak in network types; map both ways.
// ---------------------------------------------------------------------------
export type LegacyNetwork = 'unified' | 'lightning' | 'onchain' | 'spark' | 'arkade' | 'bark';
export interface LegacyRoute { networkType: LegacyNetwork; arkadeSubMode: 'ark' | 'boarding'; selectedAccount: AccountId | null }

export function legacyRoute(method: ReceiveMethodId, account: AccountId | null): LegacyRoute {
  switch (method) {
    case 'universal': return { networkType: 'unified', arkadeSubMode: 'ark', selectedAccount: null };
    case 'spark': return { networkType: 'spark', arkadeSubMode: 'ark', selectedAccount: 'SPARK' };
    case 'lightning': return { networkType: 'lightning', arkadeSubMode: 'ark', selectedAccount: account };
    case 'ark': return account === 'BARK'
      ? { networkType: 'bark', arkadeSubMode: 'ark', selectedAccount: 'BARK' }
      : { networkType: 'arkade', arkadeSubMode: 'ark', selectedAccount: 'ARKADE' };
    case 'onchain':
      if (account === 'ARKADE') return { networkType: 'arkade', arkadeSubMode: 'boarding', selectedAccount: 'ARKADE' };
      if (account === 'BARK') return { networkType: 'bark', arkadeSubMode: 'boarding', selectedAccount: 'BARK' };
      return { networkType: 'onchain', arkadeSubMode: 'ark', selectedAccount: account };
  }
}

export function routeOf(route: LegacyRoute): { method: ReceiveMethodId; account: AccountId | null } {
  const { networkType, arkadeSubMode, selectedAccount } = route;
  switch (networkType) {
    case 'unified': return { method: 'universal', account: null };
    case 'spark': return { method: 'spark', account: 'SPARK' };
    case 'lightning': return { method: 'lightning', account: selectedAccount };
    case 'onchain': return { method: 'onchain', account: selectedAccount };
    case 'arkade': return arkadeSubMode === 'boarding' ? { method: 'onchain', account: 'ARKADE' } : { method: 'ark', account: 'ARKADE' };
    case 'bark': return arkadeSubMode === 'boarding' ? { method: 'onchain', account: 'BARK' } : { method: 'ark', account: 'BARK' };
  }
}

// ---------------------------------------------------------------------------
// Universal QR: one code can only carry one chain. A test setup often has accounts on
// different chains (Spark on regtest, Arkade on mutinynet); mixing them makes the code
// a request for the wrong network, so the QR is built for one chain at a time.
// ---------------------------------------------------------------------------
export interface ChainGroup { chain: ReceiveChain; accounts: AccountId[] }

const CHAIN_ORDER: ReceiveChain[] = ['mainnet', 'signet', 'mutinynet', 'testnet', 'regtest'];

/** Chains the connected accounts are on, the one with the most accounts first (mainnet wins a tie). */
export function universalChains(accounts: ReceiveAccountInfo[]): ChainGroup[] {
  const groups = new Map<ReceiveChain, AccountId[]>();
  for (const { account, chain } of accounts) {
    if (!chain) continue;
    groups.set(chain, [...(groups.get(chain) ?? []), account]);
  }
  return [...groups.entries()]
    .map(([chain, list]) => ({ chain, accounts: list }))
    .sort((a, b) => b.accounts.length - a.accounts.length || CHAIN_ORDER.indexOf(a.chain) - CHAIN_ORDER.indexOf(b.chain));
}

/** The accounts a universal QR for `chain` may include (all of them when no chain is known). */
export function accountsOnChain(accounts: ReceiveAccountInfo[], chain: ReceiveChain | null): ReceiveAccountInfo[] {
  if (!chain) return accounts;
  return accounts.filter(a => a.chain === chain);
}

/**
 * Where the universal code's Lightning leg lands: the user's choice when it is usable
 * on this chain, else Spark, the RGB node, then Bark (only with an amount). Arkade is
 * never picked automatically: each Arkade invoice is a real swap request to a provider.
 */
export function universalLightning(options: ReceiveDestination[], chosen: AccountId | null, amountSats: number): AccountId | null {
  const usable = (d?: ReceiveDestination) => !!d && d.available && (!d.needsAmount || amountSats > 0);
  const picked = options.find(d => d.account === chosen);
  if (usable(picked)) return picked!.account;
  for (const account of ['SPARK', 'RGB', 'BARK'] as AccountId[]) {
    const d = options.find(o => o.account === account);
    if (usable(d)) return account;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Receive by account: pick the account first, then how money reaches it. The same
// (method, account) route as receiving by method, seen from the other side.
// ---------------------------------------------------------------------------
export type ReceiveAxis = 'method' | 'account';

/** Each account's ways in, its own native one first. */
const ACCOUNT_METHOD_ORDER: Record<AccountId, ReceiveMethodId[]> = {
  SPARK: ['spark', 'lightning', 'onchain'],
  ARKADE: ['ark', 'lightning', 'onchain'],
  BARK: ['ark', 'lightning', 'onchain'],
  RGB: ['lightning', 'onchain'],
};

export interface AccountMethod { method: ReceiveMethodId; destination: ReceiveDestination }

/** The ways a payment can reach `account`, with each one's availability and detail. */
export function accountMethods(
  account: AccountId, accounts: ReceiveAccountInfo[], caps: ReceiveCaps, family: AssetFamily | 'USD' = 'BTC',
): AccountMethod[] {
  const out: AccountMethod[] = [];
  for (const method of ACCOUNT_METHOD_ORDER[account]) {
    const destination = destinationsFor(method, accounts, caps, family).find(d => d.account === account);
    if (destination) out.push({ method, destination });
  }
  return out;
}

/** Accounts that can receive this asset at all, in the order Receive lists them. */
export function receivableAccounts(accounts: ReceiveAccountInfo[], caps: ReceiveCaps, family: AssetFamily | 'USD' = 'BTC'): AccountId[] {
  return (['SPARK', 'ARKADE', 'BARK', 'RGB'] as AccountId[])
    .filter(account => accountMethods(account, accounts, caps, family).some(m => m.destination.available));
}

/** The method to show when an account is picked: the current one if it still works, else its first usable one. */
export function accountDefaultMethod(options: AccountMethod[], current: ReceiveMethodId | null, amountSats = 0): ReceiveMethodId | null {
  const kept = options.find(o => o.method === current && o.destination.available);
  if (kept) return kept.method;
  const usable = options.find(o => o.destination.available && (!o.destination.needsAmount || amountSats > 0));
  return (usable ?? options.find(o => o.destination.available))?.method ?? null;
}
