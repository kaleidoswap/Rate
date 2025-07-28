// screens/NostrContactsScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  TextInput,
  VirtualizedList,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import { 
  loadContactList, 
  followUser, 
  unfollowUser,
} from '../store/slices/nostrSlice';
import { theme } from '../theme';
import { Card, Button, Input } from '../components';
import { NostrContact } from '../services/NostrService';
import { nip19 } from 'nostr-tools';

interface Props {
  navigation: any;
}

const CONTACTS_PER_PAGE = 20;

export default function NostrContactsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContactInput, setNewContactInput] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const {
    contacts,
    isContactsLoading,
    contactsError,
    isConnected,
  } = nostrState;

  // Filter contacts based on search query
  const filteredContacts = contacts.filter((contact: NostrContact) => {
    const profile = contact.profile;
    const searchLower = searchQuery.toLowerCase();
    
    return (
      (profile?.name || '').toLowerCase().includes(searchLower) ||
      (profile?.display_name || '').toLowerCase().includes(searchLower) ||
      (profile?.lud16 || '').toLowerCase().includes(searchLower)
    );
  });

  // Get paginated contacts
  const paginatedContacts = filteredContacts.slice(0, (page + 1) * CONTACTS_PER_PAGE);

  useEffect(() => {
    if (isConnected && contacts.length === 0) {
      handleRefresh();
    }
  }, [isConnected]);

  const handleRefresh = useCallback(async () => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Please connect to Nostr first in Settings');
      return;
    }

    setRefreshing(true);
    setPage(0);
    try {
      await dispatch(loadContactList() as any);
    } catch (error) {
      console.error('Failed to refresh contacts:', error);
    } finally {
      setRefreshing(false);
    }
  }, [dispatch, isConnected]);

  const loadMoreContacts = () => {
    if (loadingMore || paginatedContacts.length >= filteredContacts.length) return;
    
    setLoadingMore(true);
    setPage(prevPage => prevPage + 1);
    setLoadingMore(false);
  };

  const parseContactInput = (input: string): { pubkey: string; error?: string } => {
    const trimmed = input.trim();
    
    try {
      // Try to parse as npub
      if (trimmed.startsWith('npub')) {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === 'npub') {
          return { pubkey: decoded.data as string };
        }
      }
      
      // Try as hex pubkey (64 characters)
      if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
        return { pubkey: trimmed.toLowerCase() };
      }
      
      return { pubkey: '', error: 'Invalid format. Please enter an npub or hex pubkey.' };
    } catch (error) {
      return { pubkey: '', error: 'Invalid pubkey format.' };
    }
  };

  const handleAddContact = async () => {
    if (!newContactInput.trim()) {
      Alert.alert('Error', 'Please enter a pubkey or npub');
      return;
    }

    const { pubkey, error } = parseContactInput(newContactInput);
    if (error) {
      Alert.alert('Error', error);
      return;
    }

    // Check if already following
    if (contacts.some((c: NostrContact) => c.pubkey === pubkey)) {
      Alert.alert('Already Following', 'You are already following this user');
      return;
    }

    setIsAddingContact(true);
    try {
      await dispatch(followUser({ 
        pubkey, 
        petname: newContactName.trim() || undefined 
      }) as any);
      
      await dispatch(loadContactList() as any);
      
      setShowAddForm(false);
      setNewContactInput('');
      setNewContactName('');
      
      Alert.alert('Success', 'User added to your following list');
    } catch (error) {
      Alert.alert('Error', 'Failed to add contact');
    } finally {
      setIsAddingContact(false);
    }
  };

  const handleSendToContact = (contact: NostrContact) => {
    const lightningAddress = contact.profile?.lud16 || contact.profile?.lud06;
    
    if (lightningAddress) {
      navigation.navigate('Send', { 
        address: lightningAddress,
        contactName: contact.profile?.display_name || contact.profile?.name || contact.petname
      });
    } else {
      Alert.alert(
        'No Lightning Address', 
        'This contact does not have a Lightning address configured'
      );
    }
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <LinearGradient
        colors={['#4338ca', '#7c3aed'] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Nostr Contacts</Text>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddForm(true)}
          >
            <Ionicons name="person-add" size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );

  const renderSearchBar = () => (
    <View style={styles.searchContainer}>
      <View style={styles.searchInputContainer}>
        <Ionicons name="search" size={20} color={theme.colors.text.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search contacts..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor={theme.colors.text.muted}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color={theme.colors.text.muted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderAddForm = () => {
    if (!showAddForm) return null;

    return (
      <Card style={styles.addFormCard}>
        <View style={styles.addFormHeader}>
          <Text style={styles.addFormTitle}>Add Contact</Text>
          <TouchableOpacity onPress={() => setShowAddForm(false)}>
            <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        </View>
        
        <Input
          label="Pubkey or npub"
          placeholder="npub1... or hex pubkey"
          value={newContactInput}
          onChangeText={setNewContactInput}
          variant="outlined"
          style={styles.addFormInput}
        />
        
        <Input
          label="Name (optional)"
          placeholder="Display name for this contact"
          value={newContactName}
          onChangeText={setNewContactName}
          variant="outlined"
          style={styles.addFormInput}
        />
        
        <View style={styles.addFormActions}>
          <Button
            title="Cancel"
            onPress={() => setShowAddForm(false)}
            variant="secondary"
            style={styles.addFormCancelButton}
          />
          <Button
            title={isAddingContact ? "Adding..." : "Add Contact"}
            onPress={handleAddContact}
            loading={isAddingContact}
            disabled={isAddingContact}
            style={styles.addFormSubmitButton}
          />
        </View>
      </Card>
    );
  };

  const renderContactItem = ({ item: contact }: { item: NostrContact }) => {
    const profile = contact.profile;
    const displayName = profile?.display_name || profile?.name || contact.petname || 'Anonymous';
    const lightningAddress = profile?.lud16 || profile?.lud06;
    const avatarUrl = profile?.picture || `https://robohash.org/${contact.pubkey}?set=set3&size=96x96`;

    return (
      <TouchableOpacity 
        style={styles.contactCard}
        onPress={() => lightningAddress && handleSendToContact(contact)}
      >
        <View style={styles.contactContent}>
          <View style={styles.contactAvatar}>
            <Image 
              source={{ uri: avatarUrl }} 
              style={styles.avatarImage}
              defaultSource={require('../assets/default-avatar.png')}
            />
          </View>
          
          <View style={styles.contactInfo}>
            <Text style={styles.contactName}>{displayName}</Text>
            {lightningAddress && (
              <Text style={styles.lightningAddress} numberOfLines={1}>
                <Ionicons name="flash" size={12} color={theme.colors.warning[500]} />
                {' '}{lightningAddress}
              </Text>
            )}
          </View>
          
          {lightningAddress && (
            <Ionicons 
              name="chevron-forward" 
              size={20} 
              color={theme.colors.text.muted} 
            />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const getItem = (_data: any, index: number) => paginatedContacts[index];
  const getItemCount = () => paginatedContacts.length;
  const keyExtractor = (item: NostrContact) => item.pubkey;

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="people-outline" size={64} color={theme.colors.text.muted} />
      <Text style={styles.emptyStateTitle}>No Contacts Found</Text>
      <Text style={styles.emptyStateDescription}>
        {searchQuery 
          ? 'No contacts match your search'
          : isConnected 
          ? 'Add some contacts to get started'
          : 'Connect to Nostr to sync your contacts'
        }
      </Text>
      {isConnected && !searchQuery && (
        <Button
          title="Add Your First Contact"
          onPress={() => setShowAddForm(true)}
          style={styles.emptyStateButton}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      {renderSearchBar()}
      {renderAddForm()}
      
      {isContactsLoading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary[500]} />
          <Text style={styles.loadingText}>Loading contacts...</Text>
        </View>
      ) : (
        <VirtualizedList
          data={paginatedContacts}
          renderItem={renderContactItem}
          keyExtractor={keyExtractor}
          getItem={getItem}
          getItemCount={getItemCount}
          onEndReached={loadMoreContacts}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[theme.colors.primary[500]]}
            />
          }
          ListEmptyComponent={renderEmptyState()}
          contentContainerStyle={styles.contactsList}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator 
                size="small" 
                color={theme.colors.primary[500]} 
                style={styles.loadingMore} 
              />
            ) : null
          }
        />
      )}
    </SafeAreaView>
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
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[4],
    borderBottomLeftRadius: theme.borderRadius['2xl'],
    borderBottomRightRadius: theme.borderRadius['2xl'],
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
  },
  
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.inverse,
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
  
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[3],
  },
  
  searchInput: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  
  addFormCard: {
    marginHorizontal: theme.spacing[5],
    marginBottom: theme.spacing[4],
  },
  
  addFormHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  
  addFormTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  addFormInput: {
    marginBottom: theme.spacing[3],
  },
  
  addFormActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  
  addFormCancelButton: {
    flex: 1,
  },
  
  addFormSubmitButton: {
    flex: 1,
  },
  
  contactsList: {
    paddingHorizontal: theme.spacing[5],
  },
  
  contactCard: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[2],
    padding: theme.spacing[3],
  },
  
  contactContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  
  contactInfo: {
    flex: 1,
    marginLeft: theme.spacing[3],
  },
  
  contactName: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  
  lightningAddress: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  loadingText: {
    marginTop: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  
  loadingMore: {
    paddingVertical: theme.spacing[4],
  },
  
  emptyState: {
    alignItems: 'center',
    paddingVertical: theme.spacing[8],
  },
  
  emptyStateTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[2],
  },
  
  emptyStateDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: theme.spacing[6],
  },
  
  emptyStateButton: {
    paddingHorizontal: theme.spacing[6],
  },
}); 