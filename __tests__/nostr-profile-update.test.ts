const mockPublished: string[] = [];
let mockAccepted = 1;
jest.mock('@nostr-dev-kit/ndk', () => {
  class NDKEvent {
    kind?: number;
    content = '';
    async publish() {
      mockPublished.push(this.content);
      return new Set(Array.from({ length: mockAccepted }, (_, i) => `relay${i}`));
    }
  }
  return { __esModule: true, default: jest.fn(), NDKEvent, NDKKind: { Metadata: 0 }, NDKPrivateKeySigner: jest.fn() };
});
jest.mock('../services/NWCService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));

import NostrService from '../services/NostrService';

function serviceWith(latestContent: string | null) {
  const svc = NostrService.getInstance() as any;
  svc.user = { pubkey: 'ab' };
  svc.ndk = {
    pool: { relays: new Map([['wss://r', { connected: true }]]) },
    fetchEvent: jest.fn(async () => (latestContent === null ? null : { content: latestContent })),
  };
  return svc as NostrService;
}

beforeEach(() => {
  mockPublished.length = 0;
  mockAccepted = 1;
});

it('merges edits onto the latest relay profile, keeping fields the app does not edit', async () => {
  const svc = serviceWith(JSON.stringify({ name: 'sat', picture: 'https://x/p.png', lud06: 'lnurl1', custom: 7 }));
  const result = await svc.updateProfile({ about: 'hi', name: 'satoshi' }, { name: 'stale' });

  expect(JSON.parse(mockPublished[0])).toEqual({
    name: 'satoshi', picture: 'https://x/p.png', lud06: 'lnurl1', custom: 7, about: 'hi',
  });
  expect(result).toEqual(expect.objectContaining({ name: 'satoshi', picture: 'https://x/p.png', about: 'hi' }));
});

it('falls back to the cached profile when the relays return none', async () => {
  const svc = serviceWith(null);
  await svc.updateProfile({ about: 'hi' }, { name: 'sat', banner: 'https://x/b.png', website: undefined });
  expect(JSON.parse(mockPublished[0])).toEqual({ name: 'sat', banner: 'https://x/b.png', about: 'hi' });
});

it('throws when no relay accepts the update', async () => {
  mockAccepted = 0;
  const svc = serviceWith(null);
  await expect(svc.updateProfile({ about: 'hi' })).rejects.toThrow('No relay accepted');
});

it('throws when not connected', async () => {
  const svc = NostrService.getInstance() as any;
  svc.user = null;
  await expect(svc.updateProfile({ about: 'hi' })).rejects.toThrow('not connected');
});
