const mockPublished: string[][][] = [];
jest.mock('@nostr-dev-kit/ndk', () => {
  class NDKEvent {
    kind?: number;
    content = '';
    tags: string[][] = [];
    created_at?: number;
    async publish() {
      mockPublished.push(this.tags);
      return new Set(['relay0']);
    }
  }
  return { __esModule: true, default: jest.fn(), NDKEvent, NDKKind: { Metadata: 0, Contacts: 3 }, NDKPrivateKeySigner: jest.fn() };
});
jest.mock('../services/NWCService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));
jest.mock('expo-secure-store', () => ({}));

import NostrService from '../services/NostrService';
import reducer, { followUser, loadContactList } from '../store/slices/nostrSlice';

const key = (n: number) => n.toString(16).padStart(64, '0');
const list = (created_at: number, ...pubkeys: string[]) => ({ created_at, content: '', tags: pubkeys.map((p) => ['p', p]) });

type Sub = { handlers: Record<string, (e?: any) => void>; authors: string[]; stopped: boolean };

function serviceWith(fetchEvent: jest.Mock, onSubscribe?: (sub: Sub) => void) {
  const svc = NostrService.getInstance() as any;
  svc.user = { pubkey: 'me' };
  svc.lastContactListEvent = null;
  const subs: Sub[] = [];
  svc.ndk = {
    pool: { relays: new Map([['wss://r', { connected: true }]]) },
    fetchEvent,
    subscribe: jest.fn((filter: any) => {
      const sub: Sub = { handlers: {}, authors: filter.authors, stopped: false };
      subs.push(sub);
      const api = {
        on: (name: string, fn: any) => { sub.handlers[name] = fn; if (name === 'eose') onSubscribe?.(sub); return api; },
        stop: () => { sub.stopped = true; },
      };
      return api;
    }),
  };
  return { svc: svc as NostrService, subs };
}

beforeEach(() => {
  mockPublished.length = 0;
  jest.useRealTimers();
});

it('follows on top of the list it just published when a relay still serves the older one', async () => {
  const fetchEvent = jest.fn(async () => list(100, key(1)));
  const { svc } = serviceWith(fetchEvent);
  await svc.followUser(key(2));
  // The relay keeps answering with the list from before the first follow.
  await svc.followUser(key(3));
  expect(mockPublished[1].map((t) => t[1])).toEqual([key(1), key(2), key(3)]);
});

it('does not publish, and says why, when the follow list cannot be read in time', async () => {
  jest.useFakeTimers();
  const { svc } = serviceWith(jest.fn(() => new Promise(() => {})));
  const result = svc.followUser(key(2));
  const assertion = expect(result).rejects.toThrow('Could not read your follow list');
  await jest.advanceTimersByTimeAsync(9_000);
  await assertion;
  expect(mockPublished).toHaveLength(0);
});

it('loads profiles of a long follow list in batches, keeping the newest and only the shown fields', async () => {
  const pubkeys = Array.from({ length: 450 }, (_, i) => key(i + 1));
  const { svc, subs } = serviceWith(jest.fn(async () => list(1, ...pubkeys)), (sub) => {
    for (const author of sub.authors) {
      sub.handlers.event({ pubkey: author, created_at: 2, content: JSON.stringify({ name: 'new', banner: 'b', about: 'x'.repeat(1000) }) });
      sub.handlers.event({ pubkey: author, created_at: 1, content: JSON.stringify({ name: 'old' }) });
    }
    sub.handlers.eose();
  });
  const contacts = await svc.getContactList();
  expect(subs.map((s) => s.authors.length)).toEqual([200, 200, 50]);
  expect(contacts).toHaveLength(450);
  expect(contacts[0].profile?.name).toBe('new');
  expect(contacts[0].profile).not.toHaveProperty('banner');
  expect(contacts[0].profile!.about!.length).toBeLessThanOrEqual(281);
});

it('returns the list without waiting forever for a relay that never finishes', async () => {
  jest.useFakeTimers();
  const { svc, subs } = serviceWith(jest.fn(async () => list(1, key(1), key(2))), (sub) => {
    sub.handlers.event({ pubkey: key(1), created_at: 1, content: JSON.stringify({ name: 'alice' }) });
  });
  const result = svc.getContactList();
  await jest.advanceTimersByTimeAsync(7_000);
  const contacts = await result;
  expect(contacts.map((c) => c.profile?.name)).toEqual(['alice', undefined]);
  expect(subs[0].stopped).toBe(true);
});

describe('nostr slice', () => {
  const base = reducer(undefined, { type: 'init' });

  it('shows a new follow at once, with its profile', () => {
    const next = reducer(base, followUser.fulfilled({ pubkey: key(1), petname: 'Dad', profile: { name: 'dave', banner: 'b' } }, 'r', { pubkey: key(1) }));
    expect(next.contacts).toEqual([{ pubkey: key(1), petname: 'Dad', relay: undefined, profile: { name: 'dave' } }]);
  });

  it('keeps known profiles that a reload did not bring back', () => {
    const before = { ...base, contacts: [{ pubkey: key(1), profile: { name: 'alice' } }] };
    const next = reducer(before, loadContactList.fulfilled([{ pubkey: key(1) }, { pubkey: key(2) }], 'r'));
    expect(next.contacts).toEqual([{ pubkey: key(1), profile: { name: 'alice' } }, { pubkey: key(2) }]);
  });
});
