// store/nostrKeys.ts
// SecureStore keys for the Nostr identity. Kept in their own module so the
// persistence layer (store/nostrPersistence.ts) can use them without importing
// the slice, which pulls in NostrService and the protocol stack.
export const NOSTR_PRIVATE_KEY = 'nostr_private_key';
export const NOSTR_NSEC_KEY = 'nostr_nsec_key';
