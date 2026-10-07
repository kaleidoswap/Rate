import {
  contentToProfile,
  formatNip05,
  mergeProfileEdits,
  parseProfileContent,
  profileInitials,
  profileToForm,
  shortNpub,
  validateProfileForm,
} from './nostrProfile';

describe('mergeProfileEdits', () => {
  const published = {
    name: 'satoshi',
    display_name: 'Satoshi',
    picture: 'https://example.com/me.png',
    banner: 'https://example.com/banner.png',
    nip05: 'satoshi@example.com',
    lud06: 'lnurl1abc',
    bot: false,
    custom_client_field: { a: 1 },
  };

  it('keeps fields the form does not touch, including unknown keys', () => {
    const merged = mergeProfileEdits(published, { about: 'Hello' });
    expect(merged).toEqual({ ...published, about: 'Hello' });
  });

  it('removes a field the user cleared and trims the rest', () => {
    const merged = mergeProfileEdits(published, { banner: '  ', display_name: '  Nakamoto ' });
    expect(merged.banner).toBeUndefined();
    expect('banner' in merged).toBe(false);
    expect(merged.display_name).toBe('Nakamoto');
    expect(merged.lud06).toBe('lnurl1abc');
  });

  it('keeps the legacy displayName key in step when present', () => {
    expect(mergeProfileEdits({ displayName: 'Old' }, { display_name: 'New' })).toEqual({
      displayName: 'New',
      display_name: 'New',
    });
    expect(mergeProfileEdits({ displayName: 'Old', display_name: 'Old' }, { display_name: '' })).toEqual({});
  });

  it('starts from an empty profile when nothing was published', () => {
    expect(mergeProfileEdits(null, { name: 'alice', about: '' })).toEqual({ name: 'alice' });
  });

  it('does not mutate the base', () => {
    const base = { name: 'a' };
    mergeProfileEdits(base, { name: 'b' });
    expect(base).toEqual({ name: 'a' });
  });
});

describe('validateProfileForm', () => {
  const ok = profileToForm({
    picture: 'https://example.com/a.png',
    banner: '',
    website: 'http://example.com',
    lud16: 'me@kaleidoswap.me',
    nip05: 'example.com',
    name: 'me',
  });

  it('accepts a valid form, including a bare-domain NIP-05', () => {
    expect(validateProfileForm(ok)).toEqual({});
  });

  it('flags bad links, addresses and usernames', () => {
    const errors = validateProfileForm({
      ...ok,
      picture: 'ftp://x',
      website: 'example.com',
      lud16: 'not-an-address',
      nip05: 'a b@c',
      name: 'two words',
    });
    expect(Object.keys(errors).sort()).toEqual(['lud16', 'name', 'nip05', 'picture', 'website']);
  });
});

describe('profile content parsing', () => {
  it('parses only JSON objects', () => {
    expect(parseProfileContent('{"name":"a"}')).toEqual({ name: 'a' });
    expect(parseProfileContent('[1]')).toBeNull();
    expect(parseProfileContent('nope')).toBeNull();
    expect(parseProfileContent('')).toBeNull();
  });

  it('maps legacy keys to the app profile', () => {
    expect(contentToProfile({ displayName: 'D', image: 'https://x/y.png', lud16: 'a@b.co', other: 1 })).toEqual(
      expect.objectContaining({ display_name: 'D', picture: 'https://x/y.png', lud16: 'a@b.co' }),
    );
  });
});

describe('display helpers', () => {
  it('builds initials', () => {
    expect(profileInitials('satoshi nakamoto')).toBe('SN');
    expect(profileInitials('alice')).toBe('A');
    expect(profileInitials('  ')).toBe('');
  });

  it('shortens npubs and NIP-05 ids', () => {
    expect(shortNpub('npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqwxyz')).toBe('npub1qqqqq…wxyz');
    expect(shortNpub(null)).toBe('');
    expect(formatNip05('_@example.com')).toBe('example.com');
    expect(formatNip05('me@example.com')).toBe('me@example.com');
  });
});
