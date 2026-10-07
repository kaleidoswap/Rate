const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async (k: string) => store[k] ?? null, setItem: async (k: string, v: string) => { store[k] = v; } },
}));
import { contactEvents, contactKeyFor, recordContactEvent, updateContactEventStatus } from './contactHistory';

test('a contact’s history is what was sent to or asked from any of its identifiers', async () => {
  const base = { contactName: 'Alice', status: 'completed' as const, amount: '5,000 sats' };
  await recordContactEvent(1, { ...base, id: 'a', contactKey: contactKeyFor('Alice@Kaleidoswap.me'), direction: 'sent', createdAt: 1, attemptId: 'p1', status: 'pending' });
  await recordContactEvent(1, { ...base, id: 'b', contactKey: contactKeyFor('npub1alice'), direction: 'requested', createdAt: 2, status: 'open' });
  await recordContactEvent(1, { ...base, id: 'c', contactKey: 'bob@x.com', contactName: 'Bob', direction: 'sent', createdAt: 3 });
  await recordContactEvent(1, { ...base, id: 'a', contactKey: contactKeyFor('alice@kaleidoswap.me'), direction: 'sent', createdAt: 1, attemptId: 'p1' }); // final status
  const alice = await contactEvents(1, ['alice@kaleidoswap.me', 'npub1alice', undefined]);
  expect(alice.map((e) => [e.id, e.status])).toEqual([['b', 'open'], ['a', 'completed']]);
  expect(await contactEvents(2, ['alice@kaleidoswap.me'])).toEqual([]); // per wallet
  expect(await contactEvents(1, [])).toEqual([]);
});

test('a send’s later outcome updates its entry', async () => {
  await recordContactEvent(9, { id: 'p9', contactKey: 'carol@x.com', contactName: 'Carol', direction: 'sent', amount: '1 sat', status: 'unknown', createdAt: 5, attemptId: 'p9' });
  await updateContactEventStatus(9, 'p9', 'completed');
  await updateContactEventStatus(9, 'missing', 'failed'); // not to a contact: nothing happens
  expect((await contactEvents(9, ['carol@x.com']))[0].status).toBe('completed');
});
