import { createStore } from 'redux';
import { persistReducer, persistStore } from 'redux-persist';
import * as SecureStore from 'expo-secure-store';
import { recoverPersistence, retryPersistence, getPersistenceRecoveryState } from './persistenceRecovery';
import { migrateNostrSecretsV4, nostrSecretsTransform } from './nostrPersistence';

jest.mock('./slices/nostrSlice', () => ({ NOSTR_PRIVATE_KEY: 'nostr_private_key', NOSTR_NSEC_KEY: 'nostr_nsec_key' }));

it('does not rewrite persisted keys during a failed migration, even beyond the default timeout, and retries safely', async () => {
  jest.useFakeTimers();
  const legacy = JSON.stringify({ nostr: JSON.stringify({ privateKey: 'test-private-key', nsec: 'test-nsec' }), _persist: JSON.stringify({ version: 3, rehydrated: true }) });
  let disk = legacy;
  const storage = {
    getItem: jest.fn(async () => disk),
    setItem: jest.fn(async (_key: string, value: string) => { disk = value; }),
    removeItem: jest.fn(),
  };
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('keychain locked'));
  const reducer = persistReducer({
    key: 'root', version: 4, timeout: 0, storage,
    transforms: [nostrSecretsTransform],
    migrate: state => recoverPersistence(() => migrateNostrSecretsV4(state)),
  }, (state = { nostr: { privateKey: null, nsec: null } }) => state);
  const store = createStore(reducer);
  const persistor = persistStore(store);
  try {
    await jest.advanceTimersByTimeAsync(6000);
    expect(getPersistenceRecoveryState()).toBe(true);
    expect(persistor.getState().bootstrapped).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(disk).toBe(legacy);

    const saved = new Map();
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async key => saved.get(key) ?? null);
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key, value) => { saved.set(key, value); });
    retryPersistence();
    await jest.advanceTimersByTimeAsync(10);
    await persistor.flush();
    expect(persistor.getState().bootstrapped).toBe(true);
    expect(saved.get('nostr_private_key')).toBe('test-private-key');
    expect(saved.get('nostr_nsec_key')).toBe('test-nsec');
    expect(disk).not.toContain('test-private-key');
    expect(disk).not.toContain('test-nsec');
  } finally {
    persistor.pause();
    jest.useRealTimers();
  }
});
