import { validateAccountEndpoint } from './accountEndpoints';
test('accepts HTTPS API paths and normalizes surrounding whitespace', () => {
  expect(validateAccountEndpoint(' https://example.com/api/ ')).toBe('https://example.com/api');
});
test.each(['http://example.com', 'not a url', 'https://user:secret@example.com', 'https://example.com?token=secret', 'https://example.com#secret'])('rejects insecure or credential-bearing endpoint %s', value => {
  expect(() => validateAccountEndpoint(value)).toThrow();
});
