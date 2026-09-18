/** Strip credentials before Redux Persist writes the Nostr slice to
 * AsyncStorage. Secret material is persisted only through SecureStore. */
export function sanitizeNostrPersistedState<T extends Record<string, unknown>>(state: T): T {
  return {
    ...state,
    privateKey: null,
    nsec: null,
    nwcConnectionString: null,
  };
}
