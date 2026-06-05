// screens/ContactsScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  SectionList,
  Image,
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
import { loadContactList } from '../store/slices/nostrSlice';
import { theme } from '../theme';
import { Button, MainHeader } from '../components';
import { NostrContact } from '../services/NostrService';
import { nip19 } from 'nostr-tools';

interface Props {
  navigation: any;
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

export default function ContactsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const { contacts, searchQuery } = useSelector((state: RootState) => state.contacts);
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contactSource, setContactSource] = useState<'all' | 'local' | 'nostr'>('all');
  const [newContact, setNewContact] = useState({ name: '', lightning_address: '', node_pubkey: '', notes: '' });

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

  const handleSyncNostrContacts = async () => {
    if (!nostrState.isConnected) {
      Alert.alert('Not Connected', 'Please connect to Nostr first in Settings');
      return;
    }
    try {
      await dispatch(loadContactList() as any);
      Alert.alert('Success', 'Nostr contacts synced successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to sync Nostr contacts');
    }
  };

  const validateContact = (): boolean => {
    if (!newContact.name.trim()) {
      Alert.alert('Error', 'Please enter a contact name');
      return false;
    }
    if (!newContact.lightning_address.trim() && !newContact.node_pubkey.trim()) {
      Alert.alert('Error', 'Please enter either a Lightning address or node pubkey');
      return false;
    }
    if (newContact.lightning_address.trim()) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(newContact.lightning_address.trim())) {
        Alert.alert('Error', 'Please enter a valid Lightning address (user@domain.com)');
        return false;
      }
    }
    if (newContact.node_pubkey.trim()) {
      const pubkeyRegex = /^[0-9a-fA-F]{66}$/;
      if (!pubkeyRegex.test(newContact.node_pubkey.trim())) {
        Alert.alert('Error', 'Please enter a valid node pubkey (66 character hex string)');
        return false;
      }
    }
    return true;
  };

  const handleAddContact = () => {
    if (!validateContact()) return;
    const contact: Contact = {
      id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: newContact.name.trim(),
      lightning_address: newContact.lightning_address.trim() || undefined,
      node_pubkey: newContact.node_pubkey.trim() || undefined,
      notes: newContact.notes.trim() || undefined,
      created_at: Date.now(),
      updated_at: Date.now(),
      is_favorite: false,
    };
    dispatch(addContact(contact));
    setNewContact({ name: '', lightning_address: '', node_pubkey: '', notes: '' });
    setShowAddForm(false);
    Alert.alert('Success', 'Contact added successfully');
  };

  const handleDeleteContact = (contact: Contact) => {
    Alert.alert('Delete Contact', `Are you sure you want to delete ${contact.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => dispatch(deleteContact(contact.id)) },
    ]);
  };

  const handleContactPress = (contact: Contact) => {
    dispatch(setSelectedContact(contact));
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

      {/* Nostr quick actions */}
      {nostrState.isConnected ? (
        <View style={styles.nostrActions}>
          <TouchableOpacity style={styles.nostrActionBtn} onPress={handleSyncNostrContacts} activeOpacity={0.8}>
            <Ionicons name="sync" size={15} color={theme.colors.primary[500]} />
            <Text style={styles.nostrActionText}>Sync Nostr</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.nostrActionBtn} onPress={() => navigation.navigate('NostrContacts')} activeOpacity={0.8}>
            <Ionicons name="planet" size={15} color={theme.colors.primary[500]} />
            <Text style={styles.nostrActionText}>Manage</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.connectBanner} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
          <Ionicons name="planet-outline" size={16} color={theme.colors.text.secondary} />
          <Text style={styles.connectBannerText}>Connect Nostr to sync your social contacts</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.text.tertiary} />
        </TouchableOpacity>
      )}

      {showAddForm && renderAddForm()}
    </View>
  );

  const renderAddForm = () => (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>New Contact</Text>
      {[
        { key: 'name', label: 'Name', placeholder: 'Contact name', kbd: 'default' as const },
        { key: 'lightning_address', label: 'Lightning Address', placeholder: 'user@domain.com', kbd: 'email-address' as const },
        { key: 'node_pubkey', label: 'Node Pubkey', placeholder: '66-character hex', kbd: 'default' as const },
      ].map((f) => (
        <View key={f.key} style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{f.label}</Text>
          <TextInput
            style={styles.input}
            value={(newContact as any)[f.key]}
            onChangeText={(text) => setNewContact({ ...newContact, [f.key]: text })}
            placeholder={f.placeholder}
            placeholderTextColor={theme.colors.text.tertiary}
            keyboardType={f.kbd}
            autoCapitalize={f.key === 'name' ? 'words' : 'none'}
          />
        </View>
      ))}
      <View style={styles.formActions}>
        <Button title="Cancel" variant="secondary" onPress={() => { setShowAddForm(false); setNewContact({ name: '', lightning_address: '', node_pubkey: '', notes: '' }); }} style={{ flex: 1 }} />
        <Button title="Add" variant="primary" onPress={handleAddContact} style={{ flex: 1 }} />
      </View>
    </View>
  );

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
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(!showAddForm)}>
            <Ionicons name={showAddForm ? 'close' : 'add'} size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[10],
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
  nostrActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginTop: theme.spacing[3],
  },
  nostrActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[50],
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  nostrActionText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[500],
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
  formCard: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[5],
    marginTop: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  formTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[4],
  },
  inputGroup: {
    marginBottom: theme.spacing[3],
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
