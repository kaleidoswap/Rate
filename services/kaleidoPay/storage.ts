import * as SecureStore from 'expo-secure-store';
import { File, Directory, Paths } from 'expo-file-system';
import type { AttemptStore, SecretStore, SwapAttempt } from '@universal-bolt12/swap-market';

/** Preimages and claim keys live only in the Keychain / Keystore. */
export const secureSecretStore: SecretStore = {
  put: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  get: key => SecureStore.getItemAsync(key),
};

/**
 * Attempts as JSON files in the app sandbox. The signed claim carries the preimage in its
 * witness, so it is split off into SecureStore; the file keeps only public swap data.
 */
export function createAttemptStore(dirName = 'kaleidopay-attempts'): AttemptStore {
  const dir = new Directory(Paths.document, dirName);
  const claimKey = (id: string) => `kaleidopay.claim.${id}`;
  const file = (id: string) => new File(dir, `${id}.json`);
  const read = async (f: File): Promise<SwapAttempt | null> => {
    try {
      const a = JSON.parse(await f.text()) as SwapAttempt;
      const claim = await SecureStore.getItemAsync(claimKey(a.id));
      return claim ? { ...a, claim: JSON.parse(claim) } : a;
    } catch {
      return null;
    }
  };
  return {
    async save(a) {
      if (!dir.exists) dir.create({ intermediates: true });
      const { claim, ...rest } = a;
      if (claim) await SecureStore.setItemAsync(claimKey(a.id), JSON.stringify(claim), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      file(a.id).write(JSON.stringify(rest));
    },
    load: id => read(file(id)),
    async list() {
      if (!dir.exists) return [];
      const files = dir.list().filter((f): f is File => f instanceof File && f.name.endsWith('.json'));
      return (await Promise.all(files.map(read))).filter((a): a is SwapAttempt => !!a);
    },
  };
}
