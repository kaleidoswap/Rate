import { relayKey, withDefaultRelay, KALEIDOSWAP_RELAY } from './nostrRelays';
it('matches the NDK normalized URL to a saved relay without a slash', () => {
  expect(relayKey('wss://relay.kaleidoswap.com/')).toBe(relayKey('wss://relay.kaleidoswap.com'));
  expect(relayKey('wss://example.com/private')).not.toBe(relayKey('wss://example.com'));
});
it('includes the default for migrated users and deduplicates normalized URLs', () => {
  expect(withDefaultRelay(['wss://nos.lol/', 'wss://nos.lol'])).toEqual([KALEIDOSWAP_RELAY, 'wss://nos.lol']);
  expect(withDefaultRelay([KALEIDOSWAP_RELAY + '/'])).toEqual([KALEIDOSWAP_RELAY]);
});
