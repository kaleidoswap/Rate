// store/nostrPersistence.test.ts
import * as SecureStore from 'expo-secure-store';
import { migrateNostrSecretsV4, nostrSecretsTransform, stripNostrSecrets } from './nostrPersistence';

// The slice pulls in NostrService (NDK, relays); only its key names are needed.
jest.mock('./slices/nostrSlice', () => ({
  NOSTR_PRIVATE_KEY: 'nostr_private_key',
  NOSTR_NSEC_KEY: 'nostr_nsec_key',
}));

const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;

const legacyNostr = () => ({
  publicKey: 'pub',
  npub: 'npub1x',
  privateKey: 'deadbeef',
  nsec: 'nsec1secret',
  nwcConnectionString: 'nostr+walletconnect://abc?relay=wss%3A%2F%2Fr&secret=s3cr3t',
  hasStoredKeys: true,
  relays: ['wss://r'],
});

describe('nostr secret persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('strips secrets but keeps public fields', () => {
    const out = stripNostrSecrets(legacyNostr());
    expect(out.privateKey).toBeNull();
    expect(out.nsec).toBeNull();
    expect(out.nwcConnectionString).toBeNull();
    expect(out.publicKey).toBe('pub');
    expect(out.relays).toEqual(['wss://r']);
    expect(out.hasStoredKeys).toBe(true);
  });

  it('does not mutate the in-memory slice when writing', () => {
    const live = legacyNostr();
    const written = nostrSecretsTransform.in(live, 'nostr', {} as any) as any;
    expect(written.privateKey).toBeNull();
    expect(written.nwcConnectionString).toBeNull();
    expect(live.privateKey).toBe('deadbeef');
  });

  it('leaves outbound state untouched so the migration can see legacy keys', () => {
    const stored = legacyNostr();
    const rehydrated = nostrSecretsTransform.out(stored, 'nostr', {} as any) as any;
    expect(rehydrated.privateKey).toBe('deadbeef');
  });

  it('moves legacy keys to SecureStore when missing, then drops them', async () => {
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue(undefined);

    const state = await migrateNostrSecretsV4({ nostr: legacyNostr() });

    expect(setItem).toHaveBeenCalledWith('nostr_private_key', 'deadbeef');
    expect(setItem).toHaveBeenCalledWith('nostr_nsec_key', 'nsec1secret');
    expect(state.nostr.privateKey).toBeNull();
    expect(state.nostr.nsec).toBeNull();
    expect(state.nostr.nwcConnectionString).toBeNull();
  });

  it('does not overwrite keys already in SecureStore', async () => {
    getItem.mockResolvedValue('existing');

    const state = await migrateNostrSecretsV4({ nostr: legacyNostr() });

    expect(setItem).not.toHaveBeenCalled();
    expect(state.nostr.privateKey).toBeNull();
  });

  it('retains the source and rejects when SecureStore cannot read keys', async () => {
    getItem.mockRejectedValue(new Error('keychain locked'));
    const state = { nostr: legacyNostr() };
    await expect(migrateNostrSecretsV4(state)).rejects.toThrow('keychain locked');
    expect(state.nostr.privateKey).toBe('deadbeef');
    expect(state.nostr.nsec).toBe('nsec1secret');
  });

  it('retries safely after only one of the two keys was saved', async () => {
    const saved = new Map<string, string>();
    getItem.mockImplementation(async key => saved.get(key) ?? null);
    setItem.mockImplementation(async (key, value) => {
      if (key === 'nostr_nsec_key') throw new Error('storage unavailable');
      saved.set(key, value);
    });
    const state = { nostr: legacyNostr() };
    await expect(migrateNostrSecretsV4(state)).rejects.toThrow('storage unavailable');
    expect(state.nostr.nsec).toBe('nsec1secret');
    setItem.mockImplementation(async (key, value) => { saved.set(key, value); });
    const result = await migrateNostrSecretsV4(state);
    expect(saved.get('nostr_private_key')).toBe('deadbeef');
    expect(saved.get('nostr_nsec_key')).toBe('nsec1secret');
    expect(result.nostr.privateKey).toBeNull();
    expect(result.nostr.nsec).toBeNull();
    expect(state.nostr.privateKey).toBe('deadbeef');
  });

  it('handles a fresh install with no stored state', async () => {
    await expect(migrateNostrSecretsV4(undefined)).resolves.toBeUndefined();
  });
});
