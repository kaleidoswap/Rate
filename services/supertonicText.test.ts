import { sanitizeForSupertonic } from './supertonicText';
it('preserves accents and other scripts, but removes code, emoji and payment payloads', () => {
  expect(sanitizeForSupertonic('Perché? È già pronto! `Conferma` 😊')).toBe('Perché? È già pronto! Conferma');
  expect(sanitizeForSupertonic('日本語 한국어')).toBe('日本語 한국어');
  expect(sanitizeForSupertonic('```secret``` lnbc1' + 'a'.repeat(60))).toBe('Lightning invoice');
});
