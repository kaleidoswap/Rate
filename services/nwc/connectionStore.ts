import * as SecureStore from 'expo-secure-store';

import { parseNwcUri } from './NwcUri';

export const ACTIVE_NWC_CONNECTION_KEY = 'nwc_connection_string';
const ACTIVE_NWC_ID_KEY = 'nwc_active_connection_id';
const CONNECTION_KEY_PREFIX = 'nwc_connection_';
export const WALLET_SERVICE_NWC_URI_KEY = 'nwc_wallet_service_connection_uri';

export type NwcWalletType = 'ln' | 'rln';
export type NwcCapability =
  | 'payInvoice'
  | 'createInvoice'
  | 'readBalance'
  | 'readHistory'
  | 'lookupInvoice'
  | 'manageChannels'
  | 'rgbAssets'
  | 'onchain';

export interface SavedNwcConnection {
  id: string;
  walletPubkey: string;
  alias?: string;
  network: string;
  type: NwcWalletType;
  capabilities: NwcCapability[];
  relays: string[];
  lastConnectedAt: number;
}

export function deriveNwcCapabilities(methods: string[], isRln: boolean): NwcCapability[] {
  const advertised = new Set(methods);
  const out: NwcCapability[] = [];
  if (advertised.has('pay_invoice')) out.push('payInvoice');
  if (advertised.has('make_invoice') || advertised.has('rln_ln_invoice')) out.push('createInvoice');
  if (advertised.has('get_balance')) out.push('readBalance');
  if (advertised.has('list_transactions') || advertised.has('rln_list_payments')) out.push('readHistory');
  if (advertised.has('lookup_invoice')) out.push('lookupInvoice');
  if (isRln || advertised.has('rln_list_channels')) out.push('manageChannels');
  if (isRln || methods.some((method) => method.startsWith('rln_'))) out.push('rgbAssets', 'onchain');
  return Array.from(new Set(out));
}

export function connectionIdForUri(uri: string): string {
  return parseNwcUri(uri).walletPubkey.toLowerCase();
}

function credentialKey(id: string): string {
  const safeId = id.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid NWC connection id');
  return `${CONNECTION_KEY_PREFIX}${safeId}`;
}

export async function saveNwcCredential(id: string, uri: string): Promise<void> {
  parseNwcUri(uri);
  await SecureStore.setItemAsync(credentialKey(id), uri);
}

export async function selectNwcCredential(id: string): Promise<string> {
  const uri = await SecureStore.getItemAsync(credentialKey(id));
  if (!uri) throw new Error('This NWC credential is no longer available on this device.');
  await SecureStore.setItemAsync(ACTIVE_NWC_CONNECTION_KEY, uri);
  await SecureStore.setItemAsync(ACTIVE_NWC_ID_KEY, id);
  return uri;
}

export async function saveAndSelectNwcCredential(id: string, uri: string): Promise<void> {
  await saveNwcCredential(id, uri);
  await SecureStore.setItemAsync(ACTIVE_NWC_CONNECTION_KEY, uri);
  await SecureStore.setItemAsync(ACTIVE_NWC_ID_KEY, id);
}

export async function loadNwcCredential(id: string): Promise<string | null> {
  return SecureStore.getItemAsync(credentialKey(id));
}

export async function loadActiveNwcCredential(): Promise<{ id: string | null; uri: string | null }> {
  const [id, uri] = await Promise.all([
    SecureStore.getItemAsync(ACTIVE_NWC_ID_KEY),
    SecureStore.getItemAsync(ACTIVE_NWC_CONNECTION_KEY),
  ]);
  return { id, uri };
}

export async function removeNwcCredential(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(credentialKey(id));
  const activeId = await SecureStore.getItemAsync(ACTIVE_NWC_ID_KEY);
  if (activeId === id) {
    await Promise.all([
      SecureStore.deleteItemAsync(ACTIVE_NWC_ID_KEY),
      SecureStore.deleteItemAsync(ACTIVE_NWC_CONNECTION_KEY),
    ]);
  }
}

export function friendlyNwcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();
  if (lower.includes('timed out')) return 'The wallet did not respond. Check that it is online and that its relay is reachable.';
  if (lower.includes('unauthorized') || lower.includes('restricted')) return 'This connection does not grant permission for that action.';
  if (lower.includes('relay') || lower.includes('websocket')) return 'The Nostr relay is unavailable. Check the connection string or try again later.';
  if (lower.includes('invalid nwc') || lower.includes('walletconnect://')) return 'This is not a valid Nostr Wallet Connect string.';
  if (lower.includes('not implemented') || lower.includes('unsupported')) return 'The connected wallet does not support this operation.';
  return message || 'Could not connect to the Lightning wallet.';
}
