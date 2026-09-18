jest.mock('../services/NostrService', () => ({
  __esModule: true,
  default: { getInstance: () => ({}) },
}));

import nostrReducer, {
  clearNwcConnections,
  removeNwcConnection,
  selectNwcConnection,
  upsertNwcConnection,
} from '../store/slices/nostrSlice';
import settingsReducer, { setLastBtcReceiveRoute } from '../store/slices/settingsSlice';
import type { SavedNwcConnection } from '../services/nwc/connectionStore';

const connection = (id: string, type: 'ln' | 'rln'): SavedNwcConnection => ({
  id,
  walletPubkey: id,
  alias: type === 'rln' ? 'RGB node' : 'LN wallet',
  network: 'mainnet',
  type,
  capabilities: type === 'rln'
    ? ['payInvoice', 'createInvoice', 'manageChannels', 'rgbAssets', 'onchain']
    : ['payInvoice', 'createInvoice'],
  relays: ['wss://relay.example.com'],
  lastConnectedAt: 1,
});

describe('NWC mobile state flow', () => {
  it('switches capabilities with the active saved connection', () => {
    let state = nostrReducer(undefined, { type: 'init' });
    state = nostrReducer(state, upsertNwcConnection(connection('a', 'rln')));
    state = nostrReducer(state, upsertNwcConnection(connection('b', 'ln')));

    expect(state.selectedNwcConnectionId).toBe('b');
    expect(state.nwcCapabilities).not.toContain('manageChannels');

    state = nostrReducer(state, selectNwcConnection('a'));
    expect(state.connectedWallet).toBe('a');
    expect(state.nwcCapabilities).toContain('manageChannels');
  });

  it('falls back safely when the active wallet is removed and fully clears on wallet deletion', () => {
    let state = nostrReducer(undefined, { type: 'init' });
    state = nostrReducer(state, upsertNwcConnection(connection('a', 'rln')));
    state = nostrReducer(state, upsertNwcConnection(connection('b', 'ln')));
    state = nostrReducer(state, removeNwcConnection('b'));

    expect(state.selectedNwcConnectionId).toBe('a');
    expect(state.nwcWalletType).toBe('rln');

    state = nostrReducer(state, clearNwcConnections());
    expect(state.nwcConnections).toEqual([]);
    expect(state.selectedNwcConnectionId).toBeNull();
    expect(state.nwcCapabilities).toEqual([]);
  });

  it('persists the last explicit BTC receive destination', () => {
    const route = { axis: 'account', network: 'spark', account: 'SPARK' } as const;
    const state = settingsReducer(undefined, setLastBtcReceiveRoute(route));

    expect(state.lastBtcReceiveRoute).toEqual(route);
  });
});
