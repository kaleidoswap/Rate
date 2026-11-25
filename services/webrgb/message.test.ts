import { signWebRgbMessage, validateSignMessage } from './message';

it('matches the existing wallet-engine LND signature for the extension message-key path', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  expect(signWebRgbMessage('RGB wallet challenge 🚀', testMnemonic)).toBe(
    'rbgu1p4eg1mqyg6sybhzp3hqqog6gfom7q3un9m3s5dhzjyxz74fwc4fx9t5aafbmzaebnparyoa8qaimaioneiqw51ybrw3qm6td8bk',
  );
});

it.each(['', '\ud800', '\udfff', 'x'.repeat(8193)])('rejects an invalid message before signing', message => {
  expect(() => validateSignMessage(message)).toThrow('This message cannot be signed.');
});
