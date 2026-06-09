// components/ChatNotifications.tsx
//
// App-level listener for incoming Nostr DMs. Mounted once at the root (inside
// the Redux Provider). While Nostr is connected it subscribes to the whole DM
// inbox (NIP-17 gift wraps + legacy kind-4), files each message into the chat
// store, and — for live, incoming messages not in the currently-open thread —
// raises an in-app toast and a local OS notification, and bumps the unread
// badge. Renders nothing.
import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { nip19 } from 'nostr-tools';
import { RootState } from '../store';
import { receiveMessage, setActiveConversation } from '../store/slices/chatSlice';
import NostrService, { DirectMessage } from '../services/NostrService';
import NotificationService from '../services/NotificationService';
import ToastService from '../services/ToastService';

type Contacts = {
  localContacts: any[];
  nostrContacts: any[];
};

function resolveName(pubkey: string, { localContacts, nostrContacts }: Contacts): string {
  const nostr = nostrContacts.find((c) => c?.pubkey === pubkey);
  if (nostr) return nostr.profile?.display_name || nostr.profile?.name || nostr.petname || shortNpub(pubkey);
  const local = localContacts.find((c) => c?.node_pubkey === pubkey);
  if (local?.name) return local.name;
  return shortNpub(pubkey);
}

function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 12)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

function preview(text: string): string {
  const t = text.trim();
  return t.length > 80 ? `${t.slice(0, 77)}…` : t || 'Sent a message';
}

export default function ChatNotifications() {
  const dispatch = useDispatch();
  const isConnected = useSelector((s: RootState) => s.nostr.isConnected);
  const activePubkey = useSelector((s: RootState) => s.chat.activePubkey);
  const localContacts = useSelector((s: RootState) => s.contacts.contacts);
  const nostrContacts = useSelector((s: RootState) => s.nostr.contacts);

  // Keep the latest values available to the long-lived subscription callback
  // without re-subscribing on every change.
  const activeRef = useRef(activePubkey);
  useEffect(() => {
    activeRef.current = activePubkey;
  }, [activePubkey]);

  const contactsRef = useRef<Contacts>({ localContacts, nostrContacts });
  useEffect(() => {
    contactsRef.current = { localContacts, nostrContacts };
  }, [localContacts, nostrContacts]);

  // Clear any persisted active-conversation marker on cold start (no chat is
  // open yet), so unread counting isn't suppressed for a stale conversation.
  useEffect(() => {
    dispatch(setActiveConversation(null));
  }, [dispatch]);

  useEffect(() => {
    if (!isConnected) return;
    NotificationService.getInstance().init();

    const startedAt = Math.floor(Date.now() / 1000);
    const notified = new Set<string>();
    let subId: string | null = null;

    try {
      subId = NostrService.getInstance().subscribeToInbox((message: DirectMessage) => {
        const counterparty = message.mine ? message.recipient : message.pubkey;
        if (!counterparty) return;

        // Relays replay stored events on (re)connect; only treat recent ones as
        // live so old history doesn't spam notifications or inflate unread.
        const isLive = message.createdAt >= startedAt - 120;
        dispatch(receiveMessage({ pubkey: counterparty, message, countUnread: isLive }));

        if (message.mine || !isLive) return;
        if (counterparty === activeRef.current) return; // thread is open on screen
        if (notified.has(message.id)) return; // de-dupe across relays
        notified.add(message.id);

        const name = resolveName(counterparty, contactsRef.current);
        ToastService.getInstance().info(`${name}: ${preview(message.content)}`);
        void NotificationService.getInstance().notifyMessage(name, message.content, counterparty);
      });
    } catch (e) {
      console.warn('ChatNotifications: failed to start inbox subscription', e);
    }

    return () => {
      if (subId) NostrService.getInstance().unsubscribe(subId);
    };
  }, [isConnected, dispatch]);

  return null;
}
