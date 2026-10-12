import * as SecureStore from 'expo-secure-store';
import NostrService from './NostrService';
import { NOSTR_PRIVATE_KEY, NOSTR_NSEC_KEY } from '../store/nostrKeys';

/** NIP-06 matches the extension. Existing imported identities are never replaced. */
export async function ensureOnboardingIdentity(mnemonic: string) {
  const service = NostrService.getInstance();
  const stored = await SecureStore.getItemAsync(NOSTR_PRIVATE_KEY);
  const derived = service.deriveKeysFromMnemonic(mnemonic);
  const keys = stored ? service.importPrivateKey(stored) : derived;
  if (!keys) throw new Error('Could not prepare your Nostr identity.');
  if (!stored) {
    await SecureStore.setItemAsync(NOSTR_PRIVATE_KEY, keys.privateKey);
    await SecureStore.setItemAsync(NOSTR_NSEC_KEY, keys.nsec);
  }
  return { publicKey: keys.publicKey, npub: keys.npub, fromWallet: keys.publicKey === derived?.publicKey };
}
