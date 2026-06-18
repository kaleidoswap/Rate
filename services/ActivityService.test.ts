import { loadActivity } from './ActivityService';
import { protocolManager } from './protocols';

jest.mock('./protocols', () => ({
  protocolManager: { getAdapterIfAvailable: jest.fn() },
}));

const mockedManager = protocolManager as jest.Mocked<typeof protocolManager>;

describe('loadActivity protocol transaction ids', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates unique Arkade activity ids when the adapter returns empty transaction ids', async () => {
    const arkade = {
      isConnected: jest.fn(() => true),
      listTransactions: jest.fn(async () => [
        { id: '', type: 'receive', amount: 100, status: 'confirmed', timestamp: 1_000 },
        { id: '', type: 'receive', amount: 100, status: 'confirmed', timestamp: 1_000 },
      ]),
    };
    (mockedManager.getAdapterIfAvailable as jest.Mock).mockImplementation(
      (protocol: string) => (protocol === 'ARKADE' ? arkade : null),
    );

    const result = await loadActivity();
    const ids = result.items.map((item) => item.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain('arkade-');
  });
});
