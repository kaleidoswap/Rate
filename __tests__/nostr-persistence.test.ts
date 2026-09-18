import { sanitizeNostrPersistedState } from '../store/nostrPersistence';

describe('Nostr persisted state security', () => {
  it('removes identity and NWC credentials while retaining safe connection metadata', () => {
    const persisted = sanitizeNostrPersistedState({
      privateKey: 'private-key',
      nsec: 'nsec-secret',
      nwcConnectionString: 'nostr+walletconnect://secret',
      connectedWallet: 'wallet-pubkey',
      nwcConnections: [{ id: 'wallet-pubkey', alias: 'My node' }],
    });

    expect(persisted).toEqual({
      privateKey: null,
      nsec: null,
      nwcConnectionString: null,
      connectedWallet: 'wallet-pubkey',
      nwcConnections: [{ id: 'wallet-pubkey', alias: 'My node' }],
    });
    expect(JSON.stringify(persisted)).not.toContain('private-key');
    expect(JSON.stringify(persisted)).not.toContain('nsec-secret');
    expect(JSON.stringify(persisted)).not.toContain('walletconnect://secret');
  });
});
