// store/nostrPersistence.ts
//
// Keeps Nostr / NWC secrets out of redux-persist. AsyncStorage is a plaintext
// file (and is included in device backups), so these fields only ever live in
// memory and in SecureStore.
import { createTransform } from 'redux-persist';
import * as SecureStore from 'expo-secure-store';
import { NOSTR_PRIVATE_KEY, NOSTR_NSEC_KEY } from './slices/nostrSlice';

// The Nostr keys are reloaded from SecureStore by restoreNostrConnection. The
// NWC connection string embeds a spending secret.
export const NOSTR_SECRET_FIELDS = ['privateKey', 'nsec', 'nwcConnectionString'] as const;

export const stripNostrSecrets = <T>(nostr: T): T => {
  if (!nostr || typeof nostr !== 'object') return nostr;
  const copy: any = { ...nostr };
  for (const field of NOSTR_SECRET_FIELDS) copy[field] = null;
  return copy;
};

// Stripped on write only. Outbound transforms run before `migrate`, and
// migrateNostrSecretsV4 needs to see legacy plaintext keys to move them into
// SecureStore before dropping them.
export const nostrSecretsTransform = createTransform(
  stripNostrSecrets,
  (outbound: any) => outbound,
  { whitelist: ['nostr'] },
);

/**
 * Persist migration v4: older builds wrote the Nostr private key / nsec to
 * AsyncStorage. Make sure SecureStore holds them (so the identity isn't lost),
 * then drop the plaintext copies.
 */
export async function migrateNostrSecretsV4(state: any): Promise<any> {
  const nostr = state?.nostr;
  if (!nostr) return state;
  const moves: Array<[string, string | null | undefined]> = [
    [NOSTR_PRIVATE_KEY, nostr.privateKey],
    [NOSTR_NSEC_KEY, nostr.nsec],
  ];
  for (const [key, value] of moves) {
    if (value && !(await SecureStore.getItemAsync(key))) {
      await SecureStore.setItemAsync(key, value);
    }
  }
  // Do not mutate the source: retry must retain every legacy key on failure.
  return { ...state, nostr: stripNostrSecrets(nostr) };
}
