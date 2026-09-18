import * as SecureStore from 'expo-secure-store';

import {
  ACTIVE_NWC_CONNECTION_KEY,
  connectionIdForUri,
  deriveNwcCapabilities,
  friendlyNwcError,
  loadActiveNwcCredential,
  loadNwcCredential,
  removeNwcCredential,
  saveAndSelectNwcCredential,
  saveNwcCredential,
  selectNwcCredential,
} from '../services/nwc/connectionStore';

const walletA = 'a'.repeat(64);
const walletB = 'b'.repeat(64);
const uri = (wallet: string) =>
  `nostr+walletconnect://${wallet}?relay=${encodeURIComponent('wss://relay.example.com')}&secret=${'1'.repeat(64)}`;

describe('NWC connection store', () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => memory.get(key) ?? null);
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
      memory.set(key, value);
    });
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      memory.delete(key);
    });
  });

  it('saves multiple credentials and switches the active wallet', async () => {
    await saveAndSelectNwcCredential(walletA, uri(walletA));
    await saveNwcCredential(walletB, uri(walletB));
    await selectNwcCredential(walletB);

    expect(await loadNwcCredential(walletA)).toBe(uri(walletA));
    expect(await loadNwcCredential(walletB)).toBe(uri(walletB));
    expect(await loadActiveNwcCredential()).toEqual({ id: walletB, uri: uri(walletB) });
    expect(memory.get(ACTIVE_NWC_CONNECTION_KEY)).toBe(uri(walletB));
  });

  it('removes only the selected credential and clears its active pointer', async () => {
    await saveAndSelectNwcCredential(walletA, uri(walletA));
    await saveNwcCredential(walletB, uri(walletB));
    await removeNwcCredential(walletA);

    expect(await loadNwcCredential(walletA)).toBeNull();
    expect(await loadNwcCredential(walletB)).toBe(uri(walletB));
    expect(await loadActiveNwcCredential()).toEqual({ id: null, uri: null });
  });

  it('derives permissions from advertised NIP-47 and RLN methods', () => {
    expect(deriveNwcCapabilities(['pay_invoice', 'make_invoice', 'get_balance'], false)).toEqual([
      'payInvoice', 'createInvoice', 'readBalance',
    ]);
    expect(deriveNwcCapabilities(['pay_invoice'], true)).toEqual([
      'payInvoice', 'manageChannels', 'rgbAssets', 'onchain',
    ]);
  });

  it('uses stable wallet ids and actionable errors', () => {
    expect(connectionIdForUri(uri(walletA))).toBe(walletA);
    expect(friendlyNwcError(new Error('request timed out'))).toContain('did not respond');
    expect(friendlyNwcError(new Error('unauthorized'))).toContain('permission');
  });

  it('rejects malformed public keys and secrets before opening a relay connection', () => {
    expect(() => connectionIdForUri(uri('not-a-pubkey'))).toThrow('wallet pubkey');
    expect(() => connectionIdForUri(
      `nostr+walletconnect://${walletA}?relay=wss%3A%2F%2Frelay.example.com&secret=not-hex`,
    )).toThrow('secret');
  });
});
