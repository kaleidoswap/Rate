const URI_SCHEME = 'nostr+walletconnect://';

export interface NwcConnectionInfo {
  walletPubkey: string;
  relays: string[];
  secret: string;
  lud16?: string;
}

/** Parse the credential without loading the relay/crypto client. Keeping this
 * small also lets settings and secure-storage flows validate URIs offline. */
export function parseNwcUri(uri: string): NwcConnectionInfo {
  const trimmed = uri.trim();
  if (!trimmed.startsWith(URI_SCHEME)) {
    throw new Error('Invalid NWC URI: missing nostr+walletconnect:// scheme');
  }
  const withoutScheme = trimmed.slice(URI_SCHEME.length);
  const queryIndex = withoutScheme.indexOf('?');
  if (queryIndex === -1) throw new Error('Invalid NWC URI: missing query parameters');
  const walletPubkey = withoutScheme.slice(0, queryIndex).toLowerCase();
  const params = new URLSearchParams(withoutScheme.slice(queryIndex + 1));
  const relays = params.getAll('relay').filter(Boolean);
  const secret = params.get('secret') ?? '';
  const lud16 = params.get('lud16') ?? undefined;
  if (!walletPubkey) throw new Error('Invalid NWC URI: missing wallet pubkey');
  if (!/^[0-9a-f]{64}$/.test(walletPubkey)) {
    throw new Error('Invalid NWC URI: wallet pubkey must be 32-byte hex');
  }
  if (relays.length === 0) throw new Error('Invalid NWC URI: missing relay');
  if (!secret) throw new Error('Invalid NWC URI: missing secret');
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new Error('Invalid NWC URI: secret must be 32-byte hex');
  }
  return { walletPubkey, relays, secret, lud16 };
}
