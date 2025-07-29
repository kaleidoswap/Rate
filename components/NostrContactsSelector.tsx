// components/NostrContactsSelector.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  FlatList,
  TextInput,
  Image,
  RefreshControl,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../store';
import { loadContactList } from '../store/slices/nostrSlice';
import { theme } from '../theme';
import { NostrContact } from '../types/nostr';
import { nip19 } from 'nostr-tools';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface Contact {
  id: string;
  name: string;
  lightning_address?: string;
  node_pubkey?: string;
  notes?: string;
  avatar_url?: string;
  npub?: string;
  isNostrContact?: boolean;
  profile?: any;
}

interface Props {
  visible: boolean;
  onSelectContact: (contact: Contact) => void;
  onClose: () => void;
}

export default function NostrContactsSelector({
  visible,
  onSelectContact,
  onClose,
}: Props) {
  const [slideAnim] = useState(new Animated.Value(screenHeight));
  const [fadeAnim] = useState(new Animated.Value(0));
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  
  const dispatch = useDispatch();
  const nostrState = useSelector((state: RootState) => state.nostr);
  const contactsState = useSelector((state: RootState) => state.contacts);

  const { contacts: nostrContacts, isConnected, isContactsLoading } = nostrState;
  const { contacts: localContacts } = contactsState;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: screenHeight,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

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
      npub: nip19.npubEncode(nostrContact.pubkey),
      isNostrContact: true,
      profile: nostrContact.profile,
    };
  };

  // Combine and filter contacts
  const allContacts = [
    ...localContacts,
    ...nostrContacts.map(convertNostrContact)
  ];

  const filteredContacts = allContacts.filter((contact: Contact) => {
    // Only show contacts with lightning addresses
    if (!contact.lightning_address) return false;
    
    if (!searchQuery) return true;
    
    const query = searchQuery.toLowerCase();
    return (
      contact.name.toLowerCase().includes(query) ||
      (contact.lightning_address || '').toLowerCase().includes(query) ||
      (contact.npub || '').toLowerCase().includes(query)
    );
  });

  const handleRefresh = async () => {
    if (!isConnected) return;
    
    setRefreshing(true);
    try {
      await dispatch(loadContactList() as any);
    } catch (error) {
      console.error('Failed to refresh contacts:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelectContact = (contact: Contact) => {
    onSelectContact(contact);
    onClose();
  };

  const generateAvatarColor = (name: string) => {
    const colors = [
      theme.colors.primary[100],
      theme.colors.secondary[100],
      '#FEF3C7', // yellow light
      '#E1E7FF', // blue light
      '#FFE1E7', // pink light
      '#E7FFE1', // green light
      '#FFF1E1', // orange light
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const generateAvatarTextColor = (name: string) => {
    const colors = [
      theme.colors.primary[600],
      theme.colors.secondary[600],
      '#D97706', // yellow dark
      '#3B4FE6', // blue dark
      '#E63B5A', // pink dark
      '#059669', // green dark
      '#EA580C', // orange dark
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const renderContactItem = ({ item: contact }: { item: Contact }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => handleSelectContact(contact)}
      activeOpacity={0.7}
    >
      <View style={styles.contactContent}>
        <View style={styles.avatarContainer}>
          {contact.avatar_url ? (
            <Image
              source={{ uri: contact.avatar_url }}
              style={styles.avatar}

            />
          ) : (
            <View style={[
              styles.avatarPlaceholder,
              { backgroundColor: generateAvatarColor(contact.name) }
            ]}>
              <Text style={[
                styles.avatarText,
                { color: generateAvatarTextColor(contact.name) }
              ]}>
                {contact.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          
          {contact.isNostrContact && (
            <View style={styles.nostrBadge}>
              <Ionicons name="logo-nostr" size={10} color="white" />
            </View>
          )}
        </View>

        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>
            {contact.name}
          </Text>
          <Text style={styles.lightningAddress} numberOfLines={1}>
            ⚡ {contact.lightning_address}
          </Text>
          {contact.notes && (
            <Text style={styles.contactNotes} numberOfLines={1}>
              {contact.notes}
            </Text>
          )}
        </View>

        <View style={styles.selectIndicator}>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.gray[400]} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="people" size={48} color={theme.colors.gray[300]} />
      </View>
      <Text style={styles.emptyTitle}>No Contacts Found</Text>
      <Text style={styles.emptyMessage}>
        {searchQuery 
          ? 'No contacts match your search. Try a different search term.'
          : isConnected 
            ? 'Add friends with Lightning addresses to start sending payments.'
            : 'Connect to Nostr to see your contacts with Lightning addresses.'
        }
      </Text>
      {!isConnected && (
        <TouchableOpacity style={styles.connectButton}>
          <Text style={styles.connectButtonText}>Connect to Nostr</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
          },
        ]}
      >
        <BlurView intensity={20} style={StyleSheet.absoluteFill} />
        
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        <Animated.View
          style={[
            styles.modalContainer,
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <View style={styles.modal}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.handleBar} />
              <View style={styles.headerContent}>
                <Text style={styles.title}>Select Contact</Text>
                <Text style={styles.subtitle}>
                  Choose a friend to send payment to
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
              >
                <Ionicons name="close" size={24} color={theme.colors.gray[600]} />
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchContainer}>
              <View style={styles.searchInputContainer}>
                <Ionicons name="search" size={20} color={theme.colors.gray[400]} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search contacts..."
                  placeholderTextColor={theme.colors.gray[400]}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle" size={20} color={theme.colors.gray[400]} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Contact List */}
            <View style={styles.listContainer}>
              {isConnected && (
                <View style={styles.statsContainer}>
                  <Text style={styles.statsText}>
                    {filteredContacts.length} contact{filteredContacts.length !== 1 ? 's' : ''} with Lightning addresses
                  </Text>
                  {isConnected && (
                    <TouchableOpacity
                      style={styles.refreshButton}
                      onPress={handleRefresh}
                      disabled={refreshing}
                    >
                      <Ionicons 
                        name="refresh" 
                        size={16} 
                        color={theme.colors.primary[500]}
                        style={refreshing ? { transform: [{ rotate: '180deg' }] } : {}}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <FlatList
                data={filteredContacts}
                renderItem={renderContactItem}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={renderEmptyState}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={handleRefresh}
                    tintColor={theme.colors.primary[500]}
                  />
                }
              />
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  modalContainer: {
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    height: screenHeight * 0.85,
  },
  header: {
    paddingTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.gray[300],
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing[4],
  },
  headerContent: {
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  subtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: theme.spacing[3] + 16,
    right: theme.spacing[6],
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.gray[100],
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },
  searchInput: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  listContainer: {
    flex: 1,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.gray[50],
  },
  statsText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  refreshButton: {
    padding: theme.spacing[2],
  },
  listContent: {
    paddingBottom: theme.spacing[6],
  },
  contactItem: {
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  contactContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: theme.spacing[4],
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  nostrBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.surface.primary,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  lightningAddress: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    marginBottom: theme.spacing[1],
  },
  contactNotes: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
  },
  selectIndicator: {
    marginLeft: theme.spacing[2],
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing[8],
    paddingVertical: theme.spacing[12],
  },
  emptyIconContainer: {
    marginBottom: theme.spacing[6],
  },
  emptyTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: theme.typography.lineHeight.relaxed,
    marginBottom: theme.spacing[6],
  },
  connectButton: {
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.primary[500],
    borderRadius: theme.borderRadius.md,
  },
  connectButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: 'white',
  },
}); 