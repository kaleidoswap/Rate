// services/PairingService.ts
//
// Persistence + validation for KaleidoMind desktop pairings.
// Stores the desktop's Hyperswarm public key + friendly metadata.
// Multiple pairings supported — one is "active" at a time.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@kaleido/mind-pairings/v1';
const ACTIVE_KEY = '@kaleido/mind-pairings/active/v1';

export interface DesktopPairing {
  publicKey: string;       // Hyperswarm pubkey (full hex)
  name: string;            // Friendly name shown to the user
  model: string;           // Advisory — the model the desktop was running when paired
  pairedAt: number;        // Unix seconds
  lastUsedAt?: number;
}

export interface PairingPayload {
  v: 1;
  type: 'kaleido-mind-pair';
  publicKey: string;
  name: string;
  model: string;
  issued_at: number;
}

const MAX_AGE_SECONDS = 24 * 60 * 60; // Reject pairing QRs older than 24 h
const PUBKEY_RE = /^[0-9a-f]{40,128}$/i;

// ───────────────────────────────────────────────────────────────────────
// Parse + validate a scanned QR string into a PairingPayload
// ───────────────────────────────────────────────────────────────────────

export class PairingError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export function parsePairingPayload(raw: string): PairingPayload {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new PairingError("This QR isn't a KaleidoMind pairing code.", 'invalid_json');
  }
  if (!obj || typeof obj !== 'object') {
    throw new PairingError("This QR isn't a KaleidoMind pairing code.", 'not_object');
  }
  const p = obj as Partial<PairingPayload>;
  if (p.type !== 'kaleido-mind-pair') {
    throw new PairingError("This QR isn't a KaleidoMind pairing code.", 'wrong_type');
  }
  if (p.v !== 1) {
    throw new PairingError('Unsupported pairing format. Update your apps.', 'wrong_version');
  }
  if (typeof p.publicKey !== 'string' || !PUBKEY_RE.test(p.publicKey)) {
    throw new PairingError('Invalid public key in pairing code.', 'bad_pubkey');
  }
  if (typeof p.name !== 'string' || p.name.length === 0 || p.name.length > 80) {
    throw new PairingError('Invalid device name in pairing code.', 'bad_name');
  }
  if (typeof p.model !== 'string') {
    throw new PairingError('Invalid model in pairing code.', 'bad_model');
  }
  if (typeof p.issued_at !== 'number') {
    throw new PairingError('Missing timestamp in pairing code.', 'bad_ts');
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - p.issued_at > MAX_AGE_SECONDS) {
    throw new PairingError(
      'This pairing code has expired. Generate a fresh one on the desktop.',
      'expired',
    );
  }
  return p as PairingPayload;
}

// ───────────────────────────────────────────────────────────────────────
// Persistence
// ───────────────────────────────────────────────────────────────────────

async function readAll(): Promise<DesktopPairing[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function writeAll(pairings: DesktopPairing[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pairings));
}

export const PairingService = {
  /** All paired desktops, most recent first. */
  async list(): Promise<DesktopPairing[]> {
    const all = await readAll();
    return [...all].sort((a, b) => (b.lastUsedAt ?? b.pairedAt) - (a.lastUsedAt ?? a.pairedAt));
  },

  /** Save a pairing — upserts on public key. */
  async save(payload: PairingPayload): Promise<DesktopPairing> {
    const all = await readAll();
    const filtered = all.filter((p) => p.publicKey !== payload.publicKey);
    const pairing: DesktopPairing = {
      publicKey: payload.publicKey,
      name: payload.name,
      model: payload.model,
      pairedAt: Math.floor(Date.now() / 1000),
    };
    filtered.push(pairing);
    await writeAll(filtered);
    await AsyncStorage.setItem(ACTIVE_KEY, payload.publicKey);
    return pairing;
  },

  /** Forget one pairing. If it was active, the next most recent becomes active. */
  async forget(publicKey: string): Promise<void> {
    const all = await readAll();
    const next = all.filter((p) => p.publicKey !== publicKey);
    await writeAll(next);
    const active = await AsyncStorage.getItem(ACTIVE_KEY);
    if (active === publicKey) {
      const fallback = next.sort((a, b) => b.pairedAt - a.pairedAt)[0];
      if (fallback) {
        await AsyncStorage.setItem(ACTIVE_KEY, fallback.publicKey);
      } else {
        await AsyncStorage.removeItem(ACTIVE_KEY);
      }
    }
  },

  /** The active pairing (used by MindDelegateClient). */
  async getActive(): Promise<DesktopPairing | null> {
    const active = await AsyncStorage.getItem(ACTIVE_KEY);
    if (!active) return null;
    const all = await readAll();
    return all.find((p) => p.publicKey === active) ?? null;
  },

  /** Mark a pairing as last-used (for sort order). */
  async touch(publicKey: string): Promise<void> {
    const all = await readAll();
    const updated = all.map((p) =>
      p.publicKey === publicKey ? { ...p, lastUsedAt: Math.floor(Date.now() / 1000) } : p,
    );
    await writeAll(updated);
  },

  /** Switch which pairing is active. */
  async setActive(publicKey: string): Promise<void> {
    await AsyncStorage.setItem(ACTIVE_KEY, publicKey);
  },
};
