// screens/ContactsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  SectionList,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import {
  Contact,
  addContact,
  deleteContact,
  toggleFavorite,
  toggleNostrFavorite,
  setSearchQuery,
  setSelectedContact,
} from '../store/slices/contactsSlice';
import { loadContactList, followUser, unfollowUser } from '../store/slices/nostrSlice';
import { theme } from '../theme';
import { Button, MainHeader, Sheet, ZapModal, ZapRecipient, SegmentedTabs, Input, CopyButton, PressableScale } from '../components';
import { NostrIcon } from '../components/ProtocolIcons';
import { feedback } from '../utils/feedback';
import NostrService, { NostrContact } from '../services/NostrService';
import ToastService from '../services/ToastService';
import { contactEvents, type ContactEvent } from '../services/contactHistory';
import { nip19 } from 'nostr-tools';

interface Props {
  navigation: any;
  route?: any;
}

// A row in the list. `localId` is set when a saved contact was folded into a
// Nostr follow (same person), so the sheet can still delete the saved copy.
type ContactRow = Contact & { localId?: string };

const toast = () => ToastService.getInstance();

function avatarColors(name: string) {
  const palette = theme.colors.avatar;
  const code = name?.charCodeAt(0) || 0;
  return palette[code % palette.length];
}

// Same person: a shared Lightning address (case-insensitive) or Nostr key.
/** A contact detail's icon: the Nostr mark for Nostr, else an Ionicons glyph. */
function IdIcon({ icon, size, color }: { icon: string; size: number; color: string }) {
  return icon === 'nostr' ? <NostrIcon size={size} /> : <Ionicons name={icon as any} size={size} color={color} />;
}

function isSamePerson(local: Contact, follow: Contact): boolean {
  const ln = (c: Contact) => c.lightning_address?.trim().toLowerCase();
  if (ln(local) && ln(local) === ln(follow)) return true;
  if (local.npub && local.npub === follow.npub) return true;
  return !!local.node_pubkey && local.node_pubkey.toLowerCase() === follow.node_pubkey?.toLowerCase();
}

export default function ContactsScreen({ navigation, route }: Props) {
  const dispatch = useDispatch();
  const { contacts, searchQuery, favoriteNostrPubkeys } = useSelector((state: RootState) => state.contacts);
  const nostrFavorites = favoriteNostrPubkeys ?? []; // undefined in pre-v6 persisted state
  const nostrState = useSelector((state: RootState) => state.nostr);
  const unreadByPubkey = useSelector((state: RootState) => state.chat.unreadByPubkey) || {};
  const [showAddForm, setShowAddForm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [contactSource, setContactSource] = useState<'all' | 'local' | 'nostr'>('all');
  // Single smart-add form: a display name + one identifier (npub / NIP-05 /
  // Lightning address / node pubkey), auto-detected on submit.
  const [addName, setAddName] = useState('');
  const [addInput, setAddInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  // Zap sheet target (null = closed).
  const [zapRecipient, setZapRecipient] = useState<ZapRecipient | null>(null);
  // Contact sheet (null = closed). Holds the id so the sheet follows live edits.
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  const convertNostrContact = (nostrContact: NostrContact): Contact => {
    const displayName = nostrContact.profile?.display_name || nostrContact.profile?.name || nostrContact.petname || 'Anonymous';
    return {
      id: `nostr_${nostrContact.pubkey}`,
      name: displayName,
      lightning_address: nostrContact.profile?.lud16,
      node_pubkey: nostrContact.pubkey,
      notes: nostrContact.profile?.about,
      avatar_url: nostrContact.profile?.picture,
      created_at: Date.now(),
      updated_at: Date.now(),
      is_favorite: nostrFavorites.includes(nostrContact.pubkey.toLowerCase()),
      isNostrContact: true,
      npub: nip19.npubEncode(nostrContact.pubkey),
    };
  };

  const nostrContacts = nostrState.isConnected ? nostrState.contacts.map(convertNostrContact) : [];

  // "All" folds a saved contact into the matching follow: the Nostr entry wins
  // (it can message), favourite if either side is, and keeps the saved id.
  const merged: ContactRow[] = (() => {
    const folded = new Set<string>();
    const follows = nostrContacts.map((n): ContactRow => {
      const dup = contacts.find((l) => !folded.has(l.id) && isSamePerson(l, n));
      if (!dup) return n;
      folded.add(dup.id);
      return { ...n, is_favorite: n.is_favorite || dup.is_favorite, localId: dup.id };
    });
    return [...contacts.filter((l) => !folded.has(l.id)), ...follows];
  })();
  const allContacts: ContactRow[] =
    contactSource === 'local' ? contacts : contactSource === 'nostr' ? nostrContacts : merged;

  const filteredContacts = allContacts.filter((contact: Contact) =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.lightning_address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.node_pubkey || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.npub || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Split into Favorites + everyone else, alphabetised within each group.
  const byName = (a: Contact, b: Contact) => a.name.localeCompare(b.name);
  const favorites = filteredContacts.filter((c) => c.is_favorite).sort(byName);
  const others = filteredContacts.filter((c) => !c.is_favorite).sort(byName);
  const sections = [
    ...(favorites.length ? [{ title: 'Favorites', data: favorites }] : []),
    ...(others.length ? [{ title: favorites.length ? 'Contacts' : '', data: others }] : []),
  ];
  const openContact: ContactRow | null = openContactId ? allContacts.find((c) => c.id === openContactId) ?? null : null;
  // Payments with the open contact (what this app sent or asked for).
  const walletId = useSelector((state: RootState) => state.wallet?.activeWallet?.id);
  const [history, setHistory] = useState<ContactEvent[]>([]);
  useEffect(() => {
    setHistory([]);
    if (!openContact || walletId == null) return;
    let active = true;
    void contactEvents(walletId, [openContact.lightning_address, openContact.npub, openContact.node_pubkey])
      .then((list) => { if (active) setHistory(list); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openContactId, walletId]);

  // A QR scanned in contact mode comes back as a navigation param: open the
  // add form prefilled with the scanned identifier, then clear the param so it
  // doesn't re-fire on the next focus.
  useEffect(() => {
    const scanned = route?.params?.scannedContact;
    if (scanned) {
      setAddInput(scanned);
      setShowAddForm(true);
      navigation.setParams({ scannedContact: undefined });
    }
  }, [route?.params?.scannedContact]);

  const openContactScanner = () => {
    navigation.navigate('QRScanner', { mode: 'contact', returnScreen: 'Contacts' });
  };

  const handleRefresh = async () => {
    if (!nostrState.isConnected) {
      toast().info('Connect Nostr in Settings to sync your social contacts.');
      return;
    }
    setIsRefreshing(true);
    try {
      await dispatch(loadContactList() as any);
    } catch (error) {
      toast().error('Failed to refresh contacts.');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Lightweight identifier classification (mirrors NostrService.resolveToPubkey
  // categories) so we can show the user what was detected before submitting.
  const detectKind = (raw: string): 'nostr' | 'lightning' | 'node' | 'unknown' => {
    const s = raw.trim().replace(/^nostr:/i, '');
    if (!s) return 'unknown';
    if (/^(npub|nprofile)1[0-9a-z]+$/i.test(s)) return 'nostr';
    if (/^[0-9a-f]{64}$/i.test(s)) return 'nostr'; // 32-byte hex = Nostr pubkey
    if (/^[0-9a-f]{66}$/i.test(s)) return 'node'; // 33-byte hex = LN node pubkey
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return 'lightning'; // also covers NIP-05
    return 'unknown';
  };

  const addLocalContact = (fields: Partial<Contact>) => {
    const contact: Contact = {
      id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: (fields.name || 'Contact').trim(),
      lightning_address: fields.lightning_address,
      node_pubkey: fields.node_pubkey,
      created_at: Date.now(),
      updated_at: Date.now(),
      is_favorite: false,
    };
    dispatch(addContact(contact));
  };

  const resetAddForm = () => {
    setAddName('');
    setAddInput('');
    setShowAddForm(false);
  };

  // One flow for every kind of contact. npub / NIP-05 follow on Nostr (and the
  // typed name becomes the petname); Lightning addresses and node pubkeys are
  // stored as local contacts.
  const handleSmartAdd = async () => {
    const identifier = addInput.trim();
    const name = addName.trim();
    if (!identifier) {
      toast().error('Enter an npub, NIP-05, Lightning address, or node pubkey.');
      return;
    }

    const kind = detectKind(identifier);
    if (kind === 'unknown') {
      toast().error('Unrecognised. Use an npub1…, name@domain, a Lightning address, or a 66-char node pubkey.');
      return;
    }

    setIsAdding(true);
    try {
      // Node (LN) pubkey → local contact.
      if (kind === 'node') {
        addLocalContact({ name: name || 'Node', node_pubkey: identifier.toLowerCase() });
        resetAddForm();
        toast().success('Contact saved');
        return;
      }

      // npub / NIP-05 → resolve + follow on Nostr when connected. A NIP-05
      // (name@domain) that fails to resolve falls back to a Lightning-address
      // local contact, since the two share the same syntax.
      if (kind === 'nostr' || kind === 'lightning') {
        if (nostrState.isConnected) {
          const resolved = await NostrService.getInstance().resolveToPubkey(identifier);
          if ('pubkey' in resolved) {
            if (nostrState.contacts.some((c) => c.pubkey === resolved.pubkey)) {
              toast().info('Already in your Nostr contacts');
              return;
            }
            await dispatch(
              followUser({ pubkey: resolved.pubkey, petname: name || undefined }) as any,
            ).unwrap();
            await dispatch(loadContactList() as any);
            resetAddForm();
            toast().success('Following on Nostr');
            return;
          }
          // Could not resolve as a Nostr identity.
          if (kind === 'nostr') {
            toast().error(resolved.error || 'Could not resolve that Nostr identity.');
            return;
          }
        } else if (kind === 'nostr') {
          toast().info('Connect Nostr in Settings to follow accounts.');
          return;
        }

        // Lightning address (or unresolved NIP-05) → local contact.
        addLocalContact({ name: name || identifier.split('@')[0], lightning_address: identifier });
        resetAddForm();
        toast().success('Contact saved');
      }
    } catch (e: any) {
      toast().error(e?.message || 'Failed to add contact.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleUnfollow = (contact: ContactRow) => {
    Alert.alert('Unfollow', `Unfollow ${contact.name} on Nostr?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unfollow',
        style: 'destructive',
        onPress: async () => {
          try {
            await dispatch(unfollowUser(contact.node_pubkey!) as any).unwrap();
            await dispatch(loadContactList() as any);
          } catch (e: any) {
            toast().error(e?.message || 'Failed to unfollow.');
            return;
          }
          // Remove any local mirror under the Nostr id. A merged saved contact is
          // kept on purpose: it has its own "Delete saved contact" action.
          dispatch(deleteContact(contact.id));
          setOpenContactId(null);
        },
      },
    ]);
  };

  const handleDeleteSaved = (localId: string, name: string) => {
    Alert.alert('Delete Contact', `Are you sure you want to delete ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          dispatch(deleteContact(localId));
          setOpenContactId(null);
        },
      },
    ]);
  };

  // Follows keep their favourite by pubkey; saved contacts on the Contact. A
  // merged row shows either side's star, so un-starring clears both.
  const handleToggleFavorite = (c: ContactRow) => {
    feedback.select();
    if (!c.isNostrContact || !c.node_pubkey) {
      dispatch(toggleFavorite(c.id));
      return;
    }
    const pubkey = c.node_pubkey.toLowerCase();
    const local = c.localId ? contacts.find((l) => l.id === c.localId) : undefined;
    if (!c.is_favorite || nostrFavorites.includes(pubkey)) dispatch(toggleNostrFavorite(pubkey));
    if (c.is_favorite && local?.is_favorite) dispatch(toggleFavorite(local.id));
  };

  // Pay: zap a Nostr account or any Lightning address; otherwise fall back to
  // the full Send screen (node pubkeys).
  const payContact = (contact: Contact) => {
    dispatch(setSelectedContact(contact));
    const fromSheet = openContactId !== null;
    setOpenContactId(null);

    const pubkey = contact.isNostrContact ? contact.node_pubkey : undefined;
    if (pubkey || contact.lightning_address) {
      // Let the contact sheet finish closing first: iOS won't present a modal
      // while another one is still on screen.
      const open = () => setZapRecipient({
        name: contact.name,
        pubkey,
        lightningAddress: contact.lightning_address,
        npub: contact.npub,
        avatarUrl: contact.avatar_url,
      });
      if (fromSheet) setTimeout(open, 300); else open();
      return;
    }

    navigation.navigate('Send', {
      address: contact.lightning_address || contact.node_pubkey,
      contactName: contact.name,
    });
  };

  const messageContact = (contact: Contact) => {
    setOpenContactId(null);
    navigation.navigate('Chat', {
      pubkey: contact.node_pubkey,
      name: contact.name,
      npub: contact.npub,
      avatarUrl: contact.avatar_url,
    });
  };

  const canPay = (c: Contact) => !!(c.lightning_address || c.node_pubkey);
  const canMessage = (c: Contact) => !!(c.isNostrContact && c.node_pubkey);
  const shortKey = (k: string, head = 12, tail = 6) => (k.length > head + tail + 1 ? `${k.slice(0, head)}…${k.slice(-tail)}` : k);

  const renderAvatar = (contact: Contact, size: number) => {
    const ac = avatarColors(contact.name);
    return (
      <View style={{ width: size, height: size }}>
        <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: ac.bg }]}>
          {contact.avatar_url ? (
            <Image source={{ uri: contact.avatar_url }} style={styles.avatarImg} />
          ) : (
            <Text style={[styles.avatarInitial, { color: ac.fg, fontSize: size * 0.4 }]}>
              {contact.name.charAt(0).toUpperCase()}
            </Text>
          )}
        </View>
        {/* Nostr accounts carry a small badge instead of a separate icon next to the name. */}
        {contact.isNostrContact && (
          <View style={styles.avatarBadge}>
            <NostrIcon size={12} />
          </View>
        )}
      </View>
    );
  };

  const counts = { all: merged.length, local: contacts.length, nostr: nostrContacts.length };

  const renderHeader = () => (
    <View style={styles.listHeader}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={theme.colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts"
          value={searchQuery}
          onChangeText={(text) => dispatch(setSearchQuery(text))}
          placeholderTextColor={theme.colors.text.tertiary}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search contacts"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => dispatch(setSearchQuery(''))} accessibilityLabel="Clear search"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filters only matter once there is more than one source. */}
      {nostrState.isConnected && counts.all > 0 && (
        <SegmentedTabs
          value={contactSource}
          onChange={(k) => setContactSource(k)}
          scrollable={false}
          fill
          options={[
            { key: 'all', label: `All · ${counts.all}` },
            { key: 'local', label: `Saved · ${counts.local}` },
            { key: 'nostr', label: `Nostr · ${counts.nostr}` },
          ]}
        />
      )}

      {!nostrState.isConnected && (
        <PressableScale style={styles.connectBanner} onPress={() => navigation.navigate('NostrSettings')} scaleTo={0.98}
          accessibilityRole="button" accessibilityLabel="Connect Nostr">
          <View style={styles.connectIcon}>
            <NostrIcon size={22} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.connectTitle}>Find your friends on Nostr</Text>
            <Text style={styles.connectText}>Sync who you follow, message them and send zaps.</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
        </PressableScale>
      )}
    </View>
  );

  // Add-contact form rendered inside a Sheet. Hosting it outside the SectionList
  // (instead of in ListHeaderComponent) keeps the TextInputs mounted across
  // re-renders, so the name field no longer loses focus on every keystroke.
  const renderAddModal = () => {
    const kind = detectKind(addInput);
    const detected: Record<typeof kind, { label: string; icon: any; color: string }> = {
      nostr: { label: 'Nostr account', icon: 'nostr', color: theme.colors.primary[500] },
      lightning: { label: 'Lightning address or NIP-05', icon: 'flash', color: theme.colors.warning[500] },
      node: { label: 'Lightning node', icon: 'git-network', color: theme.colors.text.secondary },
      unknown: { label: 'Not recognised yet', icon: 'help-circle-outline', color: theme.colors.text.tertiary },
    };
    const d = detected[kind];

    return (
      <Sheet
        visible={showAddForm}
        onClose={() => { if (!isAdding) resetAddForm(); }}
        title="Add contact"
        subtitle="Paste or scan an npub, Lightning address or node key"
        footer={
          <Button
            title={isAdding ? 'Adding…' : 'Add contact'}
            variant="primary"
            onPress={handleSmartAdd}
            loading={isAdding}
            disabled={isAdding || kind === 'unknown'}
            style={styles.sheetFooterBtn}
          />
        }
      >
        <View style={styles.form}>
        <Input
          label="Address or key"
          value={addInput}
          onChangeText={setAddInput}
          placeholder="npub1…, name@domain.com"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          rightIcon={
            <TouchableOpacity
              onPress={() => { setShowAddForm(false); openContactScanner(); }}
              disabled={isAdding}
              accessibilityLabel="Scan QR code"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="qr-code-outline" size={20} color={theme.colors.primary[500]} />
            </TouchableOpacity>
          }
        />
        {addInput.trim().length > 0 && (
          <View style={styles.detectRow}>
            <IdIcon icon={d.icon} size={13} color={d.color} />
            <Text style={[styles.detectText, { color: d.color }]}>{d.label}</Text>
          </View>
        )}
        <Input
          label="Name (optional)"
          value={addName}
          onChangeText={setAddName}
          placeholder={kind === 'nostr' ? 'Uses their Nostr name if empty' : 'How you call them'}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleSmartAdd}
        />
        </View>
      </Sheet>
    );
  };

  // One contact: who they are, the ways to reach them, and the rare actions
  // (favourite, remove) that no longer crowd every row.
  const renderContactSheet = () => {
    const c = openContact;
    const ids: { label: string; value: string; display: string; icon: any; color: string }[] = c ? [
      ...(c.lightning_address ? [{ label: 'Lightning address', value: c.lightning_address, display: c.lightning_address, icon: 'flash', color: theme.colors.warning[500] }] : []),
      ...(c.npub ? [{ label: 'Nostr', value: c.npub, display: shortKey(c.npub, 14, 8), icon: 'nostr', color: theme.colors.primary[500] }] : []),
      ...(!c.isNostrContact && c.node_pubkey ? [{ label: 'Node', value: c.node_pubkey, display: shortKey(c.node_pubkey, 12, 8), icon: 'git-network', color: theme.colors.text.secondary }] : []),
    ] : [];
    const unread = c?.node_pubkey ? unreadByPubkey[c.node_pubkey] ?? 0 : 0;

    return (
      <Sheet visible={!!c} onClose={() => setOpenContactId(null)}>
        {c && (
          <View>
            <View style={styles.profileHead}>
              {renderAvatar(c, 72)}
              <Text style={styles.profileName} numberOfLines={1}>{c.name}</Text>
              {!!c.notes && <Text style={styles.profileNotes} numberOfLines={3}>{c.notes}</Text>}
            </View>

            <View style={styles.sheetActions}>
              {canPay(c) && (
                <Button title="Pay" variant="primary" onPress={() => payContact(c)} style={styles.flex}
                  icon={<Ionicons name="flash" size={16} color={theme.colors.text.inverse} />} />
              )}
              {canMessage(c) && (
                <Button title={unread > 0 ? `Message · ${Math.min(unread, 99)}` : 'Message'} variant="secondary"
                  onPress={() => messageContact(c)} style={styles.flex}
                  icon={<Ionicons name="chatbubble-ellipses-outline" size={16} color={theme.colors.text.primary} />} />
              )}
            </View>

            {ids.length > 0 && (
              <View style={styles.group}>
                {ids.map((row, i) => (
                  <View key={row.label} style={[styles.idRow, i < ids.length - 1 && styles.rowDivider]}>
                    <IdIcon icon={row.icon} size={16} color={row.color} />
                    <View style={styles.flex}>
                      <Text style={styles.idLabel}>{row.label}</Text>
                      <Text style={styles.idValue} numberOfLines={1}>{row.display}</Text>
                    </View>
                    <CopyButton value={row.value} size={16} color={theme.colors.primary[500]} />
                  </View>
                ))}
              </View>
            )}

            {history.length > 0 && (
              <View style={[styles.group, styles.groupGap]}>
                <Text style={styles.historyTitle}>Payments</Text>
                {history.slice(0, 20).map((e, i, list) => (
                  <View key={e.id} style={[styles.idRow, i < list.length - 1 && styles.rowDivider]}>
                    <Ionicons name={e.direction === 'sent' ? 'arrow-up' : 'arrow-down'} size={16}
                      color={e.direction === 'sent' ? theme.colors.text.secondary : theme.colors.tx.receive} />
                    <View style={styles.flex}>
                      <Text style={styles.idValue} numberOfLines={1}>
                        {e.direction === 'sent' ? 'Sent' : 'Requested'}{e.amount ? ` ${e.amount}` : ''}{e.note ? ` · ${e.note}` : ''}
                      </Text>
                      <Text style={styles.idLabel}>
                        {new Date(e.createdAt).toLocaleDateString()}{e.status === 'completed' || e.status === 'open' ? '' : ` · ${({ pending: 'In progress', unknown: 'Needs checking', failed: 'Failed' } as Record<string, string>)[e.status] ?? ''}`}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={[styles.group, styles.groupGap]}>
              <TouchableOpacity style={[styles.menuRow, styles.rowDivider]} onPress={() => handleToggleFavorite(c)}
                accessibilityRole="button">
                <Ionicons name={c.is_favorite ? 'star' : 'star-outline'} size={18}
                  color={c.is_favorite ? theme.colors.warning[500] : theme.colors.text.secondary} />
                <Text style={styles.menuText}>{c.is_favorite ? 'Remove from favorites' : 'Add to favorites'}</Text>
              </TouchableOpacity>
              {c.isNostrContact && c.node_pubkey && (
                <TouchableOpacity style={[styles.menuRow, !!c.localId && styles.rowDivider]} onPress={() => handleUnfollow(c)}
                  accessibilityRole="button">
                  <Ionicons name="person-remove-outline" size={18} color={theme.colors.error[500]} />
                  <Text style={[styles.menuText, styles.danger]}>Unfollow on Nostr</Text>
                </TouchableOpacity>
              )}
              {/* A plain saved contact, or the saved copy folded into this follow. */}
              {(!c.isNostrContact || c.localId) && (
                <TouchableOpacity style={styles.menuRow} onPress={() => handleDeleteSaved(c.localId ?? c.id, c.name)}
                  accessibilityRole="button">
                  <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
                  <Text style={[styles.menuText, styles.danger]}>{c.localId ? 'Delete saved contact' : 'Delete contact'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </Sheet>
    );
  };

  const renderContactItem = ({ item: contact, index, section }: { item: Contact; index: number; section: { data: Contact[] } }) => {
    const first = index === 0;
    const last = index === section.data.length - 1;
    const detail = contact.lightning_address
      ? contact.lightning_address
      : contact.npub
        ? shortKey(contact.npub)
        : contact.node_pubkey
          ? `Node ${shortKey(contact.node_pubkey, 8, 4)}`
          : 'No payment method';
    const unread = contact.node_pubkey ? unreadByPubkey[contact.node_pubkey] ?? 0 : 0;
    return (
      <PressableScale
        scaleTo={0.98}
        style={[styles.contactRow, first && styles.rowFirst, last && styles.rowLast, !last && styles.rowDivider]}
        onPress={() => { feedback.select(); setOpenContactId(contact.id); }}
        accessibilityRole="button"
        accessibilityLabel={`${contact.name}, ${detail}${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        {renderAvatar(contact, 44)}
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
          <Text style={styles.detailText} numberOfLines={1}>{detail}</Text>
        </View>

        {canMessage(contact) && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => messageContact(contact)}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityLabel={`Message ${contact.name}`}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.colors.text.secondary} />
            {unread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{Math.min(unread, 99)}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        {canPay(contact) && (
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => { feedback.select(); payContact(contact); }}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
            accessibilityLabel={`Pay ${contact.name}`}
          >
            <Ionicons name="flash" size={14} color={theme.colors.primary[500]} />
            <Text style={styles.payText}>Pay</Text>
          </TouchableOpacity>
        )}
      </PressableScale>
    );
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={searchQuery ? 'search' : 'people-outline'} size={36} color={theme.colors.text.tertiary} />
      </View>
      <Text style={styles.emptyTitle}>{searchQuery ? 'No matches' : 'No contacts yet'}</Text>
      <Text style={styles.emptyDesc}>
        {searchQuery ? 'Try a name, address or npub.' : 'Save the people you pay so they are one tap away.'}
      </Text>
      {!searchQuery && (
        <Button title="Add contact" variant="primary" size="sm" onPress={() => setShowAddForm(true)} style={styles.emptyBtn} />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <MainHeader
        title="Contacts"
        subtitle={allContacts.length ? `${allContacts.length} ${allContacts.length === 1 ? 'contact' : 'contacts'}` : undefined}
        icon="people"
        rightAction={
          <>
            {nostrState.isConnected && (
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={handleRefresh}
                disabled={isRefreshing}
                activeOpacity={0.8}
                accessibilityLabel="Sync Nostr contacts"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color={theme.colors.text.primary} />
                ) : (
                  <Ionicons name="refresh" size={19} color={theme.colors.text.primary} />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate('NostrSettings')}
              activeOpacity={0.8}
              accessibilityLabel="Nostr settings"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <NostrIcon size={19} color={theme.colors.text.primary} />
            </TouchableOpacity>
          </>
        }
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderContactItem as any}
        ListHeaderComponent={renderHeader()}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.sectionHeader}>{section.title}</Text> : <View style={styles.sectionGap} />
        }
        ListEmptyComponent={!showAddForm ? renderEmpty : null}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      {/* Floating add button — scanning lives inside the add sheet. */}
      <PressableScale
        style={styles.fab}
        onPress={() => { feedback.select(); setShowAddForm(true); }}
        scaleTo={0.92}
        accessibilityRole="button"
        accessibilityLabel="Add contact"
      >
        <Ionicons name="person-add" size={22} color={theme.colors.text.inverse} />
      </PressableScale>

      {renderAddModal()}
      {renderContactSheet()}

      <ZapModal
        visible={!!zapRecipient}
        recipient={zapRecipient}
        onClose={() => setZapRecipient(null)}
        onSuccess={({ amountSats, isZap }) =>
          toast().success(`${isZap ? 'Zap sent' : 'Payment sent'} · ${amountSats.toLocaleString()} sats to ${zapRecipient?.name ?? 'contact'}`)
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  flex: { flex: 1, minWidth: 0 },
  headerIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light,
    justifyContent: 'center', alignItems: 'center',
  },
  fab: {
    position: 'absolute', right: theme.spacing[5], bottom: theme.spacing[6],
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  listContent: { paddingHorizontal: theme.spacing[4], paddingBottom: 140, flexGrow: 1 },
  listHeader: { gap: theme.spacing[3], paddingTop: theme.spacing[3] },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2],
    backgroundColor: theme.colors.surface.primary, borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3], minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light,
  },
  searchInput: { flex: 1, fontSize: theme.typography.fontSize.base, color: theme.colors.text.primary, paddingVertical: theme.spacing[2] },
  connectBanner: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3],
    padding: theme.spacing[3], borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light,
  },
  connectIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
  },
  connectTitle: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.primary },
  connectText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary, marginTop: 2 },
  sectionHeader: {
    fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.tertiary,
    textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: theme.spacing[5], marginBottom: theme.spacing[2], marginLeft: theme.spacing[1],
  },
  sectionGap: { height: theme.spacing[4] },
  // Rows of a section read as one grouped surface, like the Dashboard asset list.
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3],
    backgroundColor: theme.colors.surface.primary,
    paddingVertical: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 64,
    borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light,
  },
  rowFirst: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: theme.borderRadius.xl, borderTopRightRadius: theme.borderRadius.xl,
  },
  rowLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomLeftRadius: theme.borderRadius.xl, borderBottomRightRadius: theme.borderRadius.xl,
  },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.light },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontWeight: '700' },
  avatarBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: 2, borderColor: theme.colors.surface.primary,
  },
  contactInfo: { flex: 1, minWidth: 0, gap: 2 },
  contactName: { fontSize: theme.typography.fontSize.base, fontWeight: '600', color: theme.colors.text.primary },
  detailText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: theme.spacing[3], height: 32, borderRadius: 16,
    backgroundColor: `${theme.colors.primary[500]}1F`,
  },
  payText: { fontSize: theme.typography.fontSize.sm, fontWeight: '700', color: theme.colors.primary[500] },
  unreadBadge: {
    position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8,
    backgroundColor: theme.colors.primary[500], alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: theme.colors.surface.primary,
  },
  unreadBadgeText: { fontSize: 9, fontWeight: '800', color: theme.colors.text.inverse },
  // Add sheet
  form: { gap: theme.spacing[3] },
  detectRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -theme.spacing[1] },
  detectText: { fontSize: theme.typography.fontSize.xs, fontWeight: '600' },
  sheetFooterBtn: { marginTop: theme.spacing[3] },
  // Contact sheet
  profileHead: { alignItems: 'center', gap: theme.spacing[1], paddingTop: theme.spacing[2], paddingBottom: theme.spacing[4] },
  profileName: { marginTop: theme.spacing[2], fontSize: theme.typography.fontSize.xl, fontWeight: '700', color: theme.colors.text.primary },
  profileNotes: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, textAlign: 'center', paddingHorizontal: theme.spacing[4] },
  sheetActions: { flexDirection: 'row', gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  group: {
    borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.background.secondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, overflow: 'hidden',
  },
  groupGap: { marginTop: theme.spacing[3] },
  historyTitle: { fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: theme.spacing[4], paddingTop: theme.spacing[3] },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingLeft: theme.spacing[4], paddingRight: theme.spacing[1], minHeight: 56 },
  idLabel: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.secondary },
  idValue: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.primary, fontWeight: '500', marginTop: 1 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingHorizontal: theme.spacing[4], minHeight: 48 },
  menuText: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.primary },
  danger: { color: theme.colors.error[500] },
  // Empty
  empty: { alignItems: 'center', paddingTop: theme.spacing[12], paddingHorizontal: theme.spacing[6] },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surface.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing[4],
  },
  emptyTitle: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.text.primary, marginBottom: theme.spacing[1] },
  emptyDesc: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, textAlign: 'center' },
  emptyBtn: { marginTop: theme.spacing[4], paddingHorizontal: theme.spacing[6] },
});
