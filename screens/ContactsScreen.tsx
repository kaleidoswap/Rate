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
  Modal,
  KeyboardAvoidingView,
  Platform,
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
  setSearchQuery,
  setSelectedContact,
} from '../store/slices/contactsSlice';
import { loadContactList, followUser, unfollowUser } from '../store/slices/nostrSlice';
import { theme } from '../theme';
import { Button, MainHeader, ZapModal, ZapRecipient } from '../components';
import NostrService, { NostrContact } from '../services/NostrService';
import { nip19 } from 'nostr-tools';

interface Props {
  navigation: any;
  route?: any;
}

// Brand-consistent tinted avatar palette (readable on the dark surface).
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: 'rgba(43,238,121,0.16)', fg: '#2BEE79' },
  { bg: 'rgba(66,144,255,0.16)', fg: '#60A5FA' },
  { bg: 'rgba(168,85,247,0.16)', fg: '#C084FC' },
  { bg: 'rgba(245,158,11,0.16)', fg: '#FBBF24' },
  { bg: 'rgba(236,72,153,0.16)', fg: '#F472B6' },
  { bg: 'rgba(20,184,166,0.16)', fg: '#2DD4BF' },
];

function avatarColors(name: string) {
  const code = name?.charCodeAt(0) || 0;
  return AVATAR_PALETTE[code % AVATAR_PALETTE.length];
}

export default function ContactsScreen({ navigation, route }: Props) {
  const dispatch = useDispatch();
  const { contacts, searchQuery } = useSelector((state: RootState) => state.contacts);
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
      is_favorite: false,
      isNostrContact: true,
      npub: nip19.npubEncode(nostrContact.pubkey),
    };
  };

  const nostrContacts = nostrState.isConnected ? nostrState.contacts.map(convertNostrContact) : [];
  const allContacts =
    contactSource === 'local' ? contacts : contactSource === 'nostr' ? nostrContacts : [...contacts, ...nostrContacts];

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
    ...(others.length ? [{ title: favorites.length ? 'All Contacts' : '', data: others }] : []),
  ];

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
      Alert.alert('Not Connected', 'Connect Nostr in Settings to sync your social contacts.');
      return;
    }
    setIsRefreshing(true);
    try {
      await dispatch(loadContactList() as any);
    } catch (error) {
      Alert.alert('Error', 'Failed to refresh contacts.');
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
      Alert.alert('Error', 'Enter an npub, NIP-05, Lightning address, or node pubkey.');
      return;
    }

    const kind = detectKind(identifier);
    if (kind === 'unknown') {
      Alert.alert('Unrecognised', 'Use an npub1…, name@domain, a Lightning address, or a 66-char node pubkey.');
      return;
    }

    setIsAdding(true);
    try {
      // Node (LN) pubkey → local contact.
      if (kind === 'node') {
        addLocalContact({ name: name || 'Node', node_pubkey: identifier.toLowerCase() });
        resetAddForm();
        Alert.alert('Added', 'Contact saved.');
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
              Alert.alert('Already following', 'This account is already in your Nostr contacts.');
              return;
            }
            await dispatch(
              followUser({ pubkey: resolved.pubkey, petname: name || undefined }) as any,
            ).unwrap();
            await dispatch(loadContactList() as any);
            resetAddForm();
            Alert.alert('Following', 'Account added to your Nostr contacts.');
            return;
          }
          // Could not resolve as a Nostr identity.
          if (kind === 'nostr') {
            Alert.alert('Not found', resolved.error || 'Could not resolve that Nostr identity.');
            return;
          }
        } else if (kind === 'nostr') {
          Alert.alert('Connect Nostr', 'Connect Nostr in Settings to follow accounts.');
          return;
        }

        // Lightning address (or unresolved NIP-05) → local contact.
        addLocalContact({ name: name || identifier.split('@')[0], lightning_address: identifier });
        resetAddForm();
        Alert.alert('Added', 'Contact saved.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to add contact.');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeleteContact = (contact: Contact) => {
    const isNostr = contact.isNostrContact && contact.node_pubkey;
    Alert.alert(
      isNostr ? 'Unfollow' : 'Delete Contact',
      isNostr
        ? `Unfollow ${contact.name} on Nostr?`
        : `Are you sure you want to delete ${contact.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isNostr ? 'Unfollow' : 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (isNostr) {
              try {
                await dispatch(unfollowUser(contact.node_pubkey!) as any).unwrap();
                await dispatch(loadContactList() as any);
              } catch (e: any) {
                Alert.alert('Error', e?.message || 'Failed to unfollow.');
                return;
              }
            }
            // Remove any local mirror as well.
            dispatch(deleteContact(contact.id));
          },
        },
      ],
    );
  };

  // Tapping a contact: zap (Nostr account or any Lightning address) is the
  // primary action; otherwise fall back to the full Send screen.
  const handleContactPress = (contact: Contact) => {
    dispatch(setSelectedContact(contact));

    const pubkey = contact.isNostrContact ? contact.node_pubkey : undefined;
    if (pubkey || contact.lightning_address) {
      setZapRecipient({
        name: contact.name,
        pubkey,
        lightningAddress: contact.lightning_address,
        npub: contact.npub,
        avatarUrl: contact.avatar_url,
      });
      return;
    }

    navigation.navigate('Send', {
      address: contact.lightning_address || contact.node_pubkey,
      contactName: contact.name,
    });
  };

  const renderHeader = () => (
    <View>
      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={theme.colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, address or npub"
          value={searchQuery}
          onChangeText={(text) => dispatch(setSearchQuery(text))}
          placeholderTextColor={theme.colors.text.tertiary}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => dispatch(setSearchQuery(''))}>
            <Ionicons name="close-circle" size={18} color={theme.colors.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Source segmented control */}
      <View style={styles.segment}>
        {([
          { key: 'all', label: 'All', count: contacts.length + nostrContacts.length },
          { key: 'local', label: 'Local', count: contacts.length },
          ...(nostrState.isConnected ? [{ key: 'nostr', label: 'Nostr', count: nostrContacts.length }] : []),
        ] as const).map((opt) => {
          const active = contactSource === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => setContactSource(opt.key as any)}
              activeOpacity={0.8}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt.label}
              </Text>
              <View style={[styles.segmentCount, active && styles.segmentCountActive]}>
                <Text style={[styles.segmentCountText, active && styles.segmentCountTextActive]}>{opt.count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Sync + Profile/Relays now live in the header (refresh + settings).
          Keep only the onboarding nudge when Nostr isn't connected. */}
      {!nostrState.isConnected && (
        <TouchableOpacity style={styles.connectBanner} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
          <Ionicons name="planet-outline" size={16} color={theme.colors.text.secondary} />
          <Text style={styles.connectBannerText}>Connect Nostr to sync your social contacts</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
      )}
    </View>
  );

  // Add-contact form rendered inside a Modal. Hosting it outside the SectionList
  // (instead of in ListHeaderComponent) keeps the TextInputs mounted across
  // re-renders, so the name field no longer loses focus on every keystroke.
  const renderAddModal = () => {
    const kind = detectKind(addInput);
    const detected: Record<typeof kind, { label: string; icon: any; color: string }> = {
      nostr: { label: 'Nostr account', icon: 'planet', color: theme.colors.primary[500] },
      lightning: { label: 'Lightning / NIP-05', icon: 'flash', color: theme.colors.warning[500] },
      node: { label: 'Node pubkey', icon: 'git-network', color: theme.colors.text.secondary },
      unknown: { label: '', icon: 'help', color: theme.colors.text.tertiary },
    };
    const d = detected[kind];

    return (
      <Modal
        visible={showAddForm}
        transparent
        animationType="slide"
        onRequestClose={() => !isAdding && resetAddForm()}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !isAdding && resetAddForm()}
          />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalSheetWrap}
          >
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.formTitle}>Add Contact</Text>
                <TouchableOpacity onPress={resetAddForm} disabled={isAdding} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.scanCta}
                onPress={() => { setShowAddForm(false); openContactScanner(); }}
                disabled={isAdding}
                activeOpacity={0.85}
              >
                <Ionicons name="qr-code-outline" size={22} color={theme.colors.text.inverse} />
                <Text style={styles.scanCtaText}>Scan QR code</Text>
              </TouchableOpacity>

              <View style={styles.orDivider}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or enter manually</Text>
                <View style={styles.orLine} />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Name (optional)</Text>
                <TextInput
                  style={styles.input}
                  value={addName}
                  onChangeText={setAddName}
                  placeholder="Display name"
                  placeholderTextColor={theme.colors.text.tertiary}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>npub, NIP-05, Lightning address, or node pubkey</Text>
                <TextInput
                  style={styles.input}
                  value={addInput}
                  onChangeText={setAddInput}
                  placeholder="npub1… · name@domain · 66-char pubkey"
                  placeholderTextColor={theme.colors.text.tertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSmartAdd}
                />
                {addInput.trim().length > 0 && kind !== 'unknown' && (
                  <View style={styles.detectRow}>
                    <Ionicons name={d.icon} size={13} color={d.color} />
                    <Text style={[styles.detectText, { color: d.color }]}>Detected: {d.label}</Text>
                  </View>
                )}
              </View>

              <View style={styles.formActions}>
                <Button title="Cancel" variant="secondary" onPress={resetAddForm} style={{ flex: 1 }} disabled={isAdding} />
                <Button
                  title={isAdding ? 'Adding…' : 'Add'}
                  variant="primary"
                  onPress={handleSmartAdd}
                  style={{ flex: 1 }}
                  loading={isAdding}
                  disabled={isAdding}
                />
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  };

  const renderContactItem = ({ item: contact }: { item: Contact }) => {
    const ac = avatarColors(contact.name);
    const detail = contact.lightning_address
      ? contact.lightning_address
      : contact.isNostrContact && contact.npub
        ? `${contact.npub.slice(0, 12)}…${contact.npub.slice(-6)}`
        : contact.node_pubkey
          ? `${contact.node_pubkey.slice(0, 10)}…`
          : 'No payment method';
    return (
      <TouchableOpacity style={styles.contactRow} activeOpacity={0.7} onPress={() => handleContactPress(contact)}>
        <View style={[styles.avatar, { backgroundColor: ac.bg }]}>
          {contact.avatar_url ? (
            <Image source={{ uri: contact.avatar_url }} style={styles.avatarImg} />
          ) : (
            <Text style={[styles.avatarInitial, { color: ac.fg }]}>{contact.name.charAt(0).toUpperCase()}</Text>
          )}
        </View>

        <View style={styles.contactInfo}>
          <View style={styles.contactNameRow}>
            <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
            {contact.isNostrContact && (
              <Ionicons name="planet" size={13} color={theme.colors.primary[500]} />
            )}
          </View>
          <View style={styles.detailRow}>
            <Ionicons
              name={contact.lightning_address ? 'flash' : 'key-outline'}
              size={12}
              color={contact.lightning_address ? theme.colors.warning[500] : theme.colors.text.tertiary}
            />
            <Text style={styles.detailText} numberOfLines={1}>{detail}</Text>
          </View>
        </View>

        {contact.isNostrContact && contact.node_pubkey && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() =>
              navigation.navigate('Chat', {
                pubkey: contact.node_pubkey,
                name: contact.name,
                npub: contact.npub,
                avatarUrl: contact.avatar_url,
              })
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Message ${contact.name}`}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={theme.colors.primary[500]} />
            {(unreadByPubkey[contact.node_pubkey] ?? 0) > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>
                  {Math.min(unreadByPubkey[contact.node_pubkey], 99)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        {(contact.lightning_address || contact.node_pubkey) && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() =>
              navigation.navigate('Send', {
                address: contact.lightning_address || contact.node_pubkey,
                contactName: contact.name,
              })
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="paper-plane-outline" size={17} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => dispatch(toggleFavorite(contact.id))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={contact.is_favorite ? 'star' : 'star-outline'}
            size={20}
            color={contact.is_favorite ? theme.colors.warning[500] : theme.colors.text.tertiary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => handleDeleteContact(contact)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color={theme.colors.error[500]} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="people-outline" size={44} color={theme.colors.text.tertiary} />
      </View>
      <Text style={styles.emptyTitle}>{searchQuery ? 'No matches' : 'No contacts yet'}</Text>
      <Text style={styles.emptyDesc}>
        {searchQuery ? 'Try a different search term.' : 'Add a contact to send payments in a tap.'}
      </Text>
      {!searchQuery && (
        <Button title="Add Contact" variant="primary" size="sm" onPress={() => setShowAddForm(true)} style={{ marginTop: theme.spacing[4], paddingHorizontal: theme.spacing[6] }} />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <MainHeader
        title="Contacts"
        subtitle={`${allContacts.length} ${allContacts.length === 1 ? 'connection' : 'connections'}`}
        icon="people"
        rightAction={
          <>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={handleRefresh}
              disabled={isRefreshing}
              activeOpacity={0.8}
              accessibilityLabel="Refresh contacts"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isRefreshing ? (
                <ActivityIndicator size="small" color={theme.colors.text.primary} />
              ) : (
                <Ionicons name="refresh" size={19} color={theme.colors.text.primary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.8}
              accessibilityLabel="Settings"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="settings-outline" size={19} color={theme.colors.text.primary} />
            </TouchableOpacity>
          </>
        }
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderContactItem}
        ListHeaderComponent={renderHeader}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={styles.sectionHeader}>{section.title}</Text> : null
        }
        ListEmptyComponent={!showAddForm ? renderEmpty : null}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />

      {/* Floating add button — scanning lives inside the add sheet. */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowAddForm(true)}
        activeOpacity={0.85}
        accessibilityLabel="Add contact"
      >
        <Ionicons name="add" size={30} color={theme.colors.text.inverse} />
      </TouchableOpacity>

      {renderAddModal()}

      <ZapModal
        visible={!!zapRecipient}
        recipient={zapRecipient}
        onClose={() => setZapRecipient(null)}
        onSuccess={({ amountSats, isZap }) =>
          Alert.alert(
            isZap ? 'Zap sent ⚡' : 'Payment sent',
            `${amountSats.toLocaleString()} sats sent to ${zapRecipient?.name ?? 'contact'}.`,
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fab: {
    position: 'absolute',
    right: theme.spacing[5],
    bottom: theme.spacing[6],
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  scanCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
    marginBottom: theme.spacing[4],
  },
  scanCtaText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[4],
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border.medium,
  },
  orText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: 150, // clear the floating action cluster
    flexGrow: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    marginTop: theme.spacing[3],
  },
  searchInput: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    padding: 0,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface.tertiary,
    borderRadius: theme.borderRadius.lg,
    padding: 4,
    marginTop: theme.spacing[3],
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  segmentBtnActive: {
    backgroundColor: theme.colors.primary[500],
  },
  segmentText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
  segmentTextActive: {
    color: theme.colors.text.inverse,
  },
  segmentCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.primary,
    alignItems: 'center',
  },
  segmentCountActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  segmentCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.text.secondary,
  },
  segmentCountTextActive: {
    color: theme.colors.text.inverse,
  },
  connectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  connectBannerText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  sectionHeader: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: theme.spacing[5],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    gap: theme.spacing[3],
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
  },
  contactInfo: {
    flex: 1,
    gap: 3,
  },
  contactNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contactName: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    flexShrink: 1,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  detailText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: theme.borderRadius.base,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.tertiary,
  },
  unreadBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.surface.primary,
  },
  unreadBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: theme.colors.text.inverse,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.background.backdrop,
  },
  modalSheetWrap: {
    width: '100%',
  },
  modalSheet: {
    backgroundColor: theme.colors.background.secondary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: theme.spacing[4],
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[4],
  },
  formTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  inputGroup: {
    marginBottom: theme.spacing[3],
  },
  detectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: theme.spacing[2],
  },
  detectText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },
  input: {
    backgroundColor: theme.colors.surface.tertiary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  formActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  empty: {
    alignItems: 'center',
    paddingTop: theme.spacing[12],
    paddingHorizontal: theme.spacing[6],
  },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: theme.colors.surface.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[4],
  },
  emptyTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  emptyDesc: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
    textAlign: 'center',
  },
});
