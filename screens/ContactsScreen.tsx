// screens/ContactsScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  FlatList,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import { 
  Contact, 
  addContact, 
  deleteContact, 
  toggleFavorite, 
  setSearchQuery, 
  setSelectedContact 
} from '../store/slices/contactsSlice';
import { 
  loadContactList,
  setShowContactSync 
} from '../store/slices/nostrSlice';
import { Image } from 'react-native';
import { theme } from '../theme';
import { Card, Button } from '../components';
import { NostrContact } from '../services/NostrService';
import { nip19 } from 'nostr-tools';

const statusBarHeight = StatusBar.currentHeight || 0;

interface Props {
  navigation: any;
}

export default function ContactsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const { contacts, searchQuery } = useSelector((state: RootState) => state.contacts);
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contactSource, setContactSource] = useState<'local' | 'nostr' | 'all'>('all');
  const [newContact, setNewContact] = useState({
    name: '',
    lightning_address: '',
    node_pubkey: '',
    notes: '',
  });

  // Convert Nostr contacts to Contact format
  const convertNostrContact = (nostrContact: NostrContact): Contact => {
    const displayName = nostrContact.profile?.display_name || 
                       nostrContact.profile?.name || 
                       nostrContact.petname || 
                       'Anonymous';
    
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

  // Generate avatar background color based on name
  const getAvatarColor = (name: string) => {
    const colors = [
      theme.colors.primary[50],
      theme.colors.success[50], 
      '#FEF3C7', // yellow light
      '#E1E7FF', // blue light
      '#FFE1E7', // pink light
      '#E7FFE1', // green light
      '#FFF1E1', // orange light
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getAvatarTextColor = (name: string) => {
    const colors = [
      theme.colors.primary[600],
      theme.colors.success[600], 
      '#D97706', // yellow dark
      '#3B4FE6', // blue dark
      '#E63B5A', // pink dark
      '#059669', // green dark
      '#EA580C', // orange dark
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Combine local and Nostr contacts
  const nostrContacts = nostrState.isConnected ? 
    nostrState.contacts.map(convertNostrContact) : [];
  
  const allContacts = contactSource === 'local' ? contacts :
                     contactSource === 'nostr' ? nostrContacts :
                     [...contacts, ...nostrContacts];

  // Filter contacts based on search query
  const filteredContacts = allContacts.filter((contact: Contact) =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.lightning_address || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.node_pubkey || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (contact.npub || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort contacts: favorites first, then alphabetically
  const sortedContacts = [...filteredContacts].sort((a, b) => {
    if (a.is_favorite && !b.is_favorite) return -1;
    if (!a.is_favorite && b.is_favorite) return 1;
    return a.name.localeCompare(b.name);
  });

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

  const generateContactId = (): string => {
    return `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

    // Validate lightning address format
    if (newContact.lightning_address.trim()) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(newContact.lightning_address.trim())) {
        Alert.alert('Error', 'Please enter a valid Lightning address (user@domain.com)');
        return false;
      }
    }

    // Validate node pubkey format (66 character hex string)
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
      id: generateContactId(),
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
    Alert.alert(
      'Delete Contact',
      `Are you sure you want to delete ${contact.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => dispatch(deleteContact(contact.id)),
        },
      ]
    );
  };

  const handleToggleFavorite = (contactId: string) => {
    dispatch(toggleFavorite(contactId));
  };

  const handleContactPress = (contact: Contact) => {
    dispatch(setSelectedContact(contact));
    navigation.navigate('Send', { 
      address: contact.lightning_address || contact.node_pubkey,
      contactName: contact.name 
    });
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <LinearGradient
        colors={['#4338ca', '#7c3aed'] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <SafeAreaView style={styles.headerSafeArea}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIcon}>
                <Ionicons name="people" size={24} color="white" />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.headerTitle}>Contacts</Text>
                <Text style={styles.headerSubtitle}>Lightning Network Connections</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddForm(!showAddForm)}
            >
              <Ionicons name="add" size={24} color={theme.colors.text.inverse} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );

  const renderSearchBar = () => (
    <View style={styles.searchContainer}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color={theme.colors.text.secondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts..."
          value={searchQuery}
          onChangeText={(text) => dispatch(setSearchQuery(text))}
          placeholderTextColor={theme.colors.text.secondary}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => dispatch(setSearchQuery(''))}>
            <Ionicons name="close-circle" size={20} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderContactControls = () => (
    <View style={styles.controlsContainer}>
      {/* Contact Source Switcher */}
      <View style={styles.sourceSwitcher}>
        <TouchableOpacity
          style={[styles.sourceButton, contactSource === 'all' && styles.sourceButtonActive]}
          onPress={() => setContactSource('all')}
        >
          <Text style={[styles.sourceButtonText, contactSource === 'all' && styles.sourceButtonTextActive]}>
            All ({allContacts.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sourceButton, contactSource === 'local' && styles.sourceButtonActive]}
          onPress={() => setContactSource('local')}
        >
          <Text style={[styles.sourceButtonText, contactSource === 'local' && styles.sourceButtonTextActive]}>
            Local ({contacts.length})
          </Text>
        </TouchableOpacity>
        {nostrState.isConnected && (
          <TouchableOpacity
            style={[styles.sourceButton, contactSource === 'nostr' && styles.sourceButtonActive]}
            onPress={() => setContactSource('nostr')}
          >
            <Text style={[styles.sourceButtonText, contactSource === 'nostr' && styles.sourceButtonTextActive]}>
              Nostr ({nostrContacts.length})
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Nostr Controls */}
      {nostrState.isConnected && (
        <View style={styles.nostrControls}>
          <TouchableOpacity
            style={styles.syncButton}
            onPress={handleSyncNostrContacts}
          >
            <Ionicons name="refresh" size={16} color={theme.colors.primary[500]} />
            <Text style={styles.syncButtonText}>Sync Nostr</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.nostrContactsButton}
            onPress={() => navigation.navigate('NostrContacts')}
          >
            <Ionicons name="planet" size={16} color={theme.colors.primary[500]} />
            <Text style={styles.nostrContactsButtonText}>Manage Nostr</Text>
          </TouchableOpacity>
        </View>
      )}

      {!nostrState.isConnected && (
        <TouchableOpacity
          style={styles.connectNostrButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <Ionicons name="planet-outline" size={16} color={theme.colors.text.secondary} />
          <Text style={styles.connectNostrText}>Connect to Nostr to sync contacts</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderAddContactForm = () => {
    if (!showAddForm) return null;

    return (
      <Card style={styles.addFormCard}>
        <Text style={styles.addFormTitle}>Add New Contact</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Name *</Text>
          <TextInput
            style={styles.input}
            value={newContact.name}
            onChangeText={(text) => setNewContact({ ...newContact, name: text })}
            placeholder="Contact name"
            placeholderTextColor={theme.colors.text.secondary}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Lightning Address</Text>
          <TextInput
            style={styles.input}
            value={newContact.lightning_address}
            onChangeText={(text) => setNewContact({ ...newContact, lightning_address: text })}
            placeholder="user@domain.com"
            placeholderTextColor={theme.colors.text.secondary}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Node Pubkey</Text>
          <TextInput
            style={styles.input}
            value={newContact.node_pubkey}
            onChangeText={(text) => setNewContact({ ...newContact, node_pubkey: text })}
            placeholder="66 character hex string"
            placeholderTextColor={theme.colors.text.secondary}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Notes (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={newContact.notes}
            onChangeText={(text) => setNewContact({ ...newContact, notes: text })}
            placeholder="Additional notes..."
            placeholderTextColor={theme.colors.text.secondary}
            multiline
            numberOfLines={3}
          />
        </View>

        <View style={styles.formActions}>
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              setShowAddForm(false);
              setNewContact({ name: '', lightning_address: '', node_pubkey: '', notes: '' });
            }}
            style={styles.formActionButton}
          />
          <Button
            title="Add Contact"
            variant="primary"
            onPress={handleAddContact}
            style={styles.formActionButton}
          />
        </View>
      </Card>
    );
  };

  const renderContactItem = ({ item: contact }: { item: Contact }) => (
    <Card style={styles.contactCard}>
      <TouchableOpacity
        style={styles.contactItem}
        onPress={() => handleContactPress(contact)}
      >
        <View style={styles.contactHeader}>
          <View style={[
            styles.contactAvatar, 
            { backgroundColor: getAvatarColor(contact.name) }
          ]}>
            {contact.avatar_url ? (
              <Image source={{ uri: contact.avatar_url }} style={styles.contactImage} />
            ) : (
              <Text style={[
                styles.contactInitial,
                { color: getAvatarTextColor(contact.name) }
              ]}>
                {contact.name.charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={styles.contactInfo}>
            <View style={styles.contactNameRow}>
              <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
              <View style={styles.contactBadges}>
                {contact.isNostrContact && (
                  <View style={styles.nostrBadge}>
                    <Ionicons name="planet" size={12} color={theme.colors.primary[500]} />
                  </View>
                )}
                {contact.is_favorite && (
                  <Ionicons name="star" size={16} color="#f59e0b" />
                )}
              </View>
            </View>
            
            {/* Only show lightning address if available */}
            {contact.lightning_address && (
              <View style={styles.contactDetailRow}>
                <Ionicons name="flash" size={14} color={theme.colors.warning[500]} />
                <Text style={styles.contactDetail} numberOfLines={1}>
                  {contact.lightning_address}
                </Text>
              </View>
            )}
            
            {/* Show Nostr pubkey for Nostr contacts */}
            {contact.isNostrContact && contact.npub && (
              <View style={styles.contactDetailRow}>
                <Ionicons name="key" size={14} color={theme.colors.primary[500]} />
                <Text style={styles.contactDetail} numberOfLines={1}>
                  {contact.npub.substring(0, 20)}...
                </Text>
              </View>
            )}
          </View>
        </View>
        
        <View style={styles.contactActions}>
          <TouchableOpacity
            style={styles.contactActionButton}
            onPress={() => handleToggleFavorite(contact.id)}
          >
            <Ionicons 
              name={contact.is_favorite ? "star" : "star-outline"} 
              size={20} 
              color={contact.is_favorite ? "#f59e0b" : theme.colors.text.secondary} 
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.contactActionButton}
            onPress={() => handleDeleteContact(contact)}
          >
            <Ionicons name="trash-outline" size={20} color={theme.colors.error[500]} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Card>
  );

  const renderEmptyState = () => (
    <Card style={styles.emptyCard}>
      <View style={styles.emptyState}>
        <View style={styles.emptyIcon}>
          <Ionicons name="people-outline" size={48} color={theme.colors.gray[400]} />
        </View>
        <Text style={styles.emptyTitle}>No contacts yet</Text>
        <Text style={styles.emptyDescription}>
          Add your first contact to get started with quick payments
        </Text>
        <Button
          title="Add Contact"
          variant="primary"
          size="sm"
          onPress={() => setShowAddForm(true)}
          style={styles.emptyButton}
        />
      </View>
    </Card>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      {renderSearchBar()}
      {renderContactControls()}
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderAddContactForm()}
        
        {sortedContacts.length === 0 && !showAddForm ? (
          renderEmptyState()
        ) : (
          <View style={styles.contactsList}>
            <FlatList
              data={sortedContacts}
              renderItem={renderContactItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              showsVerticalScrollIndicator={false}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  
  headerGradient: {
    paddingTop: Platform.OS === 'android' ? statusBarHeight : 0,
    paddingBottom: theme.spacing[6],
    borderBottomLeftRadius: theme.borderRadius['2xl'],
    borderBottomRightRadius: theme.borderRadius['2xl'],
  },
  
  headerSafeArea: {
    backgroundColor: 'transparent',
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
  },
  
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  
  headerIcon: {
    marginRight: theme.spacing[3],
  },
  
  headerText: {
    flex: 1,
  },
  
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: 2,
  },
  
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    fontWeight: '500',
  },
  
  addButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  searchContainer: {
    paddingHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[4],
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
  },
  
  searchInput: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  
  scrollView: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
    paddingBottom: theme.spacing[6],
  },
  
  addFormCard: {
    marginBottom: theme.spacing[4],
    padding: theme.spacing[5],
  },
  
  addFormTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[4],
  },
  
  inputGroup: {
    marginBottom: theme.spacing[4],
  },
  
  inputLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  input: {
    backgroundColor: theme.colors.background.secondary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  
  formActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  
  formActionButton: {
    flex: 1,
  },
  
  contactsList: {
    gap: theme.spacing[3],
  },
  
  contactCard: {
    marginBottom: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.primary,
    shadowColor: theme.colors.gray[900],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },

  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    justifyContent: 'space-between',
  },

  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  contactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
    overflow: 'hidden',
  },

  contactImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },

  contactInitial: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
  },
    
  contactInfo: {
    flex: 1,
    marginRight: theme.spacing[2],
  },

  contactNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[1],
  },

  contactName: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    flex: 1,
  },

  contactBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },

  nostrBadge: {
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[1],
  },

  contactDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing[1],
    gap: theme.spacing[1],
  },

  contactDetail: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    flex: 1,
  },

  contactActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },

  contactActionButton: {
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.gray[50],
  },
  
  emptyCard: {
    paddingVertical: theme.spacing[8],
  },
  
  emptyState: {
    alignItems: 'center',
  },
  
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[4],
  },
  
  emptyTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  emptyDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[5],
  },
  
  emptyButton: {
    paddingHorizontal: theme.spacing[6],
  },

  // New Nostr-related styles
  controlsContainer: {
    marginBottom: theme.spacing[4],
  },

  sourceSwitcher: {
    flexDirection: 'row',
    backgroundColor: theme.colors.gray[100],
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[1],
    marginBottom: theme.spacing[3],
  },

  sourceButton: {
    flex: 1,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    alignItems: 'center',
  },

  sourceButtonActive: {
    backgroundColor: theme.colors.primary[500],
  },

  sourceButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
  },

  sourceButtonTextActive: {
    color: theme.colors.text.inverse,
  },

  nostrControls: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },

  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    backgroundColor: theme.colors.primary[50],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },

  syncButtonText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    fontWeight: '500',
  },

  nostrContactsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
    backgroundColor: theme.colors.primary[50],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },

  nostrContactsButtonText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    fontWeight: '500',
  },

  connectNostrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.gray[50],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
  },

  connectNostrText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },

  nostrBadgeText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    fontWeight: '500',
  },
}); 