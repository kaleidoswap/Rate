// utils/nostrProfile.ts
//
// Pure helpers for the user's Nostr profile (kind-0 metadata): the edit form,
// light validation, and merging edits onto the published profile.
import type { NostrProfile } from '../services/NostrService';

export const PROFILE_FORM_FIELDS = [
  'picture',
  'banner',
  'display_name',
  'name',
  'about',
  'nip05',
  'lud16',
  'website',
] as const;

export type ProfileFormField = (typeof PROFILE_FORM_FIELDS)[number];
export type ProfileForm = Record<ProfileFormField, string>;
export type ProfileFormErrors = Partial<Record<ProfileFormField, string>>;

export function profileToForm(profile?: Partial<NostrProfile> | null): ProfileForm {
  const form = {} as ProfileForm;
  for (const field of PROFILE_FORM_FIELDS) {
    const value = profile?.[field];
    form[field] = typeof value === 'string' ? value : '';
  }
  return form;
}

const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
// name@domain.tld — the shape shared by Lightning addresses and NIP-05 ids.
const ADDRESS_RE = /^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function isHttpUrl(value: string): boolean {
  return URL_RE.test(value.trim());
}

export function validateProfileForm(form: ProfileForm): ProfileFormErrors {
  const errors: ProfileFormErrors = {};
  const v = (f: ProfileFormField) => form[f].trim();

  for (const field of ['picture', 'banner', 'website'] as const) {
    if (v(field) && !isHttpUrl(v(field))) errors[field] = 'Enter a link starting with https://';
  }
  if (v('lud16') && !ADDRESS_RE.test(v('lud16'))) {
    errors.lud16 = 'Use the form name@domain.com';
  }
  // NIP-05 allows a bare domain, meaning _@domain.
  const nip05 = v('nip05');
  if (nip05 && !ADDRESS_RE.test(nip05) && !ADDRESS_RE.test(`_@${nip05}`)) {
    errors.nip05 = 'Use the form name@domain.com';
  }
  if (/\s/.test(v('name'))) errors.name = 'No spaces in a username';
  return errors;
}

/**
 * Apply form edits to the full kind-0 content last published by the user.
 * Kind 0 is replaceable: whatever we publish replaces the whole profile, so
 * fields the form does not show (lud06, bot, custom keys from other clients)
 * must be carried over. A cleared field removes the key.
 */
export function mergeProfileEdits(
  base: Record<string, unknown> | null | undefined,
  edits: Partial<Record<ProfileFormField, string>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const field of PROFILE_FORM_FIELDS) {
    if (!(field in edits)) continue;
    const value = (edits[field] ?? '').trim();
    if (value) merged[field] = value;
    else delete merged[field];
    // Some clients still write the legacy camelCase key; keep it in step.
    if (field === 'display_name' && 'displayName' in merged) {
      if (value) merged.displayName = value;
      else delete merged.displayName;
    }
  }
  return merged;
}

/** Parse kind-0 event content into a plain object, or null if it isn't one. */
export function parseProfileContent(content: string | undefined | null): Record<string, unknown> | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The typed fields the app keeps in state, read from raw kind-0 content. */
export function contentToProfile(content: Record<string, unknown>): NostrProfile {
  const str = (k: string) => (typeof content[k] === 'string' ? (content[k] as string) : undefined);
  return {
    name: str('name'),
    display_name: str('display_name') ?? str('displayName'),
    about: str('about'),
    picture: str('picture') ?? str('image'),
    banner: str('banner'),
    website: str('website'),
    nip05: str('nip05'),
    lud16: str('lud16'),
    lud06: str('lud06'),
  };
}

const CONTACT_ABOUT_MAX = 280;

/**
 * Only what a contact row and sheet show. Follow lists can hold thousands of
 * profiles, and they are kept in persisted state.
 */
export function slimContactProfile(content: Record<string, unknown> | NostrProfile | null | undefined): NostrProfile | null {
  if (!content) return null;
  const { name, display_name, about, picture, nip05, lud16 } = contentToProfile(content as Record<string, unknown>);
  const slim: NostrProfile = {};
  if (name) slim.name = name;
  if (display_name) slim.display_name = display_name;
  if (about) slim.about = about.length > CONTACT_ABOUT_MAX ? `${about.slice(0, CONTACT_ABOUT_MAX)}…` : about;
  if (picture) slim.picture = picture;
  if (nip05) slim.nip05 = nip05;
  if (lud16) slim.lud16 = lud16;
  return Object.keys(slim).length > 0 ? slim : null;
}

export function profileDisplayName(profile?: Partial<NostrProfile> | null): string {
  return (profile?.display_name || profile?.name || '').trim();
}

/** A follow's name: the one the user gave them, else their own profile name. */
export function nostrContactName(contact: { petname?: string; profile?: Partial<NostrProfile> | null }): string {
  return contact.petname?.trim() || profileDisplayName(contact.profile);
}

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0])[0] ?? '';
  const second = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + second).toUpperCase();
}

export function shortNpub(npub?: string | null): string {
  if (!npub) return '';
  return npub.length > 20 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

/** NIP-05 `_@domain` is shown as just the domain. */
export function formatNip05(nip05?: string | null): string {
  const v = (nip05 ?? '').trim();
  return v.startsWith('_@') ? v.slice(2) : v;
}

const NOSTR_ID = /^(?:nostr:)?((?:npub|nprofile)1[02-9ac-hj-np-z]+)$/i;

/** The bare npub1… / nprofile1… in a scanned or pasted code, with or without `nostr:`. */
export function nostrIdentity(data: string): string | null {
  const match = NOSTR_ID.exec(data.trim());
  return match ? match[1].toLowerCase() : null;
}
