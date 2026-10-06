// services/contactHistory.ts
//
// Payments and requests made with a contact, as the app saw them: sends from
// Send to a picked contact and Receive requests made for one. The wallets'
// own histories don't say who a payment was with, so this local log is what
// a contact's page shows. Per wallet, newest first, capped.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ContactEvent {
  id: string;
  /** Lightning address (lower case), npub or node pubkey the payment went to / was asked from. */
  contactKey: string;
  contactName: string;
  direction: 'sent' | 'requested';
  /** Pre-formatted amount, e.g. "5,000 sats" ('' for an open-amount request). */
  amount: string;
  status: 'completed' | 'pending' | 'unknown' | 'failed' | 'open';
  note?: string;
  createdAt: number;
  /** Payment attempt behind a send, to update its status later. */
  attemptId?: string;
}

const MAX_EVENTS = 200;
const key = (walletId: number) => `contact-history-v1-${walletId}`;

export const contactKeyFor = (destination: string) => destination.trim().toLowerCase();

async function load(walletId: number): Promise<ContactEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(key(walletId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** Adds an event, or updates the one with the same id (e.g. a send's final status). */
export async function recordContactEvent(walletId: number, event: ContactEvent): Promise<void> {
  const list = (await load(walletId)).filter((e) => e.id !== event.id);
  list.unshift(event);
  await AsyncStorage.setItem(key(walletId), JSON.stringify(list.slice(0, MAX_EVENTS)));
}

/** Events with any of the contact's identifiers (Lightning address, npub, node pubkey). */
export async function contactEvents(walletId: number, identifiers: Array<string | undefined | null>): Promise<ContactEvent[]> {
  const keys = new Set(identifiers.filter((v): v is string => !!v).map(contactKeyFor));
  if (!keys.size) return [];
  return (await load(walletId)).filter((e) => keys.has(e.contactKey)).sort((a, b) => b.createdAt - a.createdAt);
}

/** A send's later outcome (Send re-checks unresolved payments). No-op if it wasn't to a contact. */
export async function updateContactEventStatus(walletId: number, id: string, status: ContactEvent['status']): Promise<void> {
  const list = await load(walletId);
  const event = list.find((e) => e.id === id);
  if (!event || event.status === status) return;
  event.status = status;
  await AsyncStorage.setItem(key(walletId), JSON.stringify(list));
}
