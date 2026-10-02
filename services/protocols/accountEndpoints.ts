/** Endpoint settings are public configuration, never credentials. */
export function validateAccountEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || url.search) {
    throw new Error('Use an HTTPS URL without credentials, query parameters or a fragment.');
  }
  return url.toString().replace(/\/$/, '');
}
