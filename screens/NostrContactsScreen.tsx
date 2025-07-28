// screens/NostrContactsScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Share,
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
  getUserInfo,
  setShowContactSync,
  clearContactsError,
} from '../store/slices/nostrSlice';
import { theme } from '../theme';
import { Card, Button, Input } from '../components';
import { NostrContact } from '../services/NostrService';
import { nip19 } from 'nostr-tools';

interface Props {
  navigation: any;
}

export default function NostrContactsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContactInput, setNewContactInput] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const {
    contacts,
    isContactsLoading,
    contactsError,
    isConnected,
    contactsLastUpdated,
  } = nostrState;

  // Filter contacts based on search query
  const filteredContacts = contacts.filter(contact => {
    const profile = contact.profile;
    const searchLower = searchQuery.toLowerCase();
    
    return (
      (profile?.name || '').toLowerCase().includes(searchLower) ||
      (profile?.display_name || '').toLowerCase().includes(searchLower) ||
      (profile?.nip05 || '').toLowerCase().includes(searchLower) ||
      (contact.petname || '').toLowerCase().includes(searchLower) ||
      contact.pubkey.toLowerCase().includes(searchLower)
    );
  });

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
    try {
      await dispatch(loadContactList() as any);
    } catch (error) {
      console.error('Failed to refresh contacts:', error);
    } finally {
      setRefreshing(false);
    }
  }, [dispatch, isConnected]);

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
    if (contacts.some(c => c.pubkey === pubkey)) {
      Alert.alert('Already Following', 'You are already following this user');
      return;
    }

    setIsAddingContact(true);
    try {
      await dispatch(followUser({ 
        pubkey, 
        petname: newContactName.trim() || undefined 
      }) as any);
      
      // Refresh contact list to show the new contact
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

  const handleUnfollow = (contact: NostrContact) => {
    const displayName = contact.profile?.display_name || contact.profile?.name || contact.petname || 'this user';
    
    Alert.alert(
      'Unfollow User',
      `Are you sure you want to unfollow ${displayName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Unfollow', 
          style: 'destructive',
          onPress: async () => {
            try {
              await dispatch(unfollowUser(contact.pubkey) as any);
              Alert.alert('Success', 'User unfollowed');
            } catch (error) {
              Alert.alert('Error', 'Failed to unfollow user');
            }
          }
        }
      ]
    );
  };

  const handleShareContact = async (contact: NostrContact) => {
    try {
      const npub = nip19.npubEncode(contact.pubkey);
      const displayName = contact.profile?.display_name || contact.profile?.name || 'Nostr user';
      
      await Share.share({
        message: `Check out ${displayName} on Nostr: ${npub}`,
        title: 'Share Nostr Contact',
      });
    } catch (error) {
      console.error('Failed to share contact:', error);
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

  const renderConnectionStatus = () => {
    if (!isConnected) {
      return (
        <Card style={styles.statusCard}>
          <View style={styles.statusContent}>
            <Ionicons name="warning-outline" size={24} color={theme.colors.warning[500]} />
            <View style={styles.statusText}>
              <Text style={styles.statusTitle}>Not Connected</Text>
              <Text style={styles.statusDescription}>
                Connect to Nostr in Settings to sync your contacts
              </Text>
            </View>
            <TouchableOpacity
              style={styles.statusButton}
              onPress={() => navigation.navigate('Settings')}
            >
              <Text style={styles.statusButtonText}>Go to Settings</Text>
            </TouchableOpacity>
          </View>
        </Card>
      );
    }

    return null;
  };

  const renderSyncStatus = () => {
    if (!isConnected) return null;

    const lastUpdated = contactsLastUpdated 
      ? new Date(contactsLastUpdated).toLocaleTimeString()
      : 'Never';

    return (
      <View style={styles.syncStatus}>
        <Text style={styles.syncStatusText}>
          Last synced: {lastUpdated}
        </Text>
        <TouchableOpacity 
          style={styles.syncButton}
          onPress={handleRefresh}
          disabled={isContactsLoading}
        >
          <Ionicons 
            name="refresh" 
            size={16} 
            color={theme.colors.primary[500]} 
          />
          <Text style={styles.syncButtonText}>Sync</Text>
        </TouchableOpacity>
      </View>
    );
  };

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
            variant="outline"
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
    const npub = nip19.npubEncode(contact.pubkey);
    const hasLightning = !!(profile?.lud16 || profile?.lud06);

    return (
      <Card style={styles.contactCard}>
        <View style={styles.contactHeader}>
          <View style={styles.contactAvatar}>
            {profile?.picture ? (
              <Text>🖼️</Text>
            ) : (
              <Ionicons name="person" size={24} color={theme.colors.text.secondary} />
            )}
          </View>
          
          <View style={styles.contactInfo}>
            <Text style={styles.contactName}>{displayName}</Text>
            {profile?.nip05 && (
              <Text style={styles.contactNip05}>✓ {profile.nip05}</Text>
            )}
            <Text style={styles.contactPubkey} numberOfLines={1}>
              {npub.slice(0, 16)}...{npub.slice(-8)}
            </Text>
            {profile?.about && (
              <Text style={styles.contactAbout} numberOfLines={2}>
                {profile.about}
              </Text>
            )}
          </View>
          
          <View style={styles.contactActions}>
            {hasLightning && (
              <TouchableOpacity
                style={styles.contactActionButton}
                onPress={() => handleSendToContact(contact)}
              >
                <Ionicons name="flash" size={18} color={theme.colors.primary[500]} />
              </TouchableOpacity>
            )}
            
            <TouchableOpacity
              style={styles.contactActionButton}
              onPress={() => handleShareContact(contact)}
            >
              <Ionicons name="share-outline" size={18} color={theme.colors.text.secondary} />
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.contactActionButton}
              onPress={() => handleUnfollow(contact)}
            >
              <Ionicons name="person-remove" size={18} color={theme.colors.error[500]} />
            </TouchableOpacity>
          </View>
        </View>
      </Card>
    );
  };

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

  const renderError = () => {
    if (!contactsError) return null;

    return (
      <Card style={styles.errorCard}>
        <View style={styles.errorContent}>
          <Ionicons name="warning-outline" size={24} color={theme.colors.error[500]} />
          <View style={styles.errorText}>
            <Text style={styles.errorTitle}>Error Loading Contacts</Text>
            <Text style={styles.errorDescription}>{contactsError}</Text>
          </View>
          <TouchableOpacity
            style={styles.errorButton}
            onPress={() => dispatch(clearContactsError())}
          >
            <Ionicons name="close" size={20} color={theme.colors.error[500]} />
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      
      <ScrollView 
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[theme.colors.primary[500]]}
          />
        }
      >
        {renderConnectionStatus()}
        {renderError()}
        {renderAddForm()}
        
        {isConnected && (
          <>
            {renderSyncStatus()}
            {renderSearchBar()}
            
            {isContactsLoading && !refreshing ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.primary[500]} />
                <Text style={styles.loadingText}>Loading contacts...</Text>
              </View>
            ) : filteredContacts.length > 0 ? (
              <FlatList
                data={filteredContacts}
                renderItem={renderContactItem}
                keyExtractor={(item) => item.pubkey}
                contentContainerStyle={styles.contactsList}
                scrollEnabled={false}
              />
            ) : (
              renderEmptyState()
            )}
          </>
        )}
      </ScrollView>
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
    paddingBottom: theme.spacing[6],
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
  
  scrollView: {
    flex: 1,
    paddingHorizontal: theme.spacing[5],
  },
  
  statusCard: {
    marginBottom: theme.spacing[4],
  },
  
  statusContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  
  statusText: {
    flex: 1,
  },
  
  statusTitle: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  
  statusDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  statusButton: {
    backgroundColor: theme.colors.primary[500],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  
  statusButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
  
  syncStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
  },
  
  syncStatusText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  
  syncButtonText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[500],
    fontWeight: '500',
  },
  
  searchContainer: {
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
    paddingBottom: theme.spacing[6],
  },
  
  contactCard: {
    marginBottom: theme.spacing[3],
  },
  
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
  },
  
  contactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  contactInfo: {
    flex: 1,
  },
  
  contactName: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  
  contactNip05: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.success[600],
    marginBottom: theme.spacing[1],
  },
  
  contactPubkey: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    fontFamily: 'monospace',
    marginBottom: theme.spacing[1],
  },
  
  contactAbout: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    lineHeight: 18,
  },
  
  contactActions: {
    flexDirection: 'row',
    gap: theme.spacing[1],
  },
  
  contactActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: theme.spacing[8],
  },
  
  loadingText: {
    marginTop: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
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
  
  errorCard: {
    marginBottom: theme.spacing[4],
    backgroundColor: theme.colors.error[50],
    borderWidth: 1,
    borderColor: theme.colors.error[100],
  },
  
  errorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
  },
  
  errorText: {
    flex: 1,
  },
  
  errorTitle: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.error[700],
    marginBottom: theme.spacing[1],
  },
  
  errorDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[600],
  },
  
  errorButton: {
    padding: theme.spacing[1],
  },
}); 