// components/NostrProfileManager.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  ScrollView,
  Clipboard,
  Share,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import {
  initializeNostr,
  loadNostrProfile,
  updateNostrProfile,
  setKeys,
  clearKeys,
  setConnected,
  setError,
} from '../store/slices/nostrSlice';
import NostrService from '../services/NostrService';
import { theme } from '../theme';
import { Card, Button, Input } from '../components';

interface Props {
  navigation?: any;
}

export default function NostrProfileManager({ navigation }: Props) {
  const dispatch = useDispatch();
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [showKeyImport, setShowKeyImport] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    display_name: '',
    about: '',
    website: '',
    lud16: '', // Lightning address
  });

  const {
    isConnected,
    isInitializing,
    profile,
    isProfileLoading,
    publicKey,
    npub,
    nsec,
    error,
  } = nostrState;

  useEffect(() => {
    if (profile) {
      setProfileForm({
        name: profile.name || '',
        display_name: profile.display_name || '',
        about: profile.about || '',
        website: profile.website || '',
        lud16: profile.lud16 || '',
      });
    }
  }, [profile]);

  const handleGenerateKeys = async () => {
    Alert.alert(
      'Generate New Keys',
      'This will create a new Nostr identity. Make sure to backup your keys safely!',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Generate', 
          onPress: async () => {
            try {
              const nostrService = NostrService.getInstance();
              const keys = nostrService.generateKeyPair();
              
              dispatch(setKeys(keys));
              
              // Initialize with new keys
              const settings = {
                privateKey: keys.privateKey,
                relays: nostrState.relays,
              };
              
              await dispatch(initializeNostr(settings) as any);
              
              Alert.alert(
                'Keys Generated',
                'New Nostr keys have been generated. Please backup your private key (nsec) safely!',
                [
                  { text: 'OK' },
                  { 
                    text: 'Backup Now', 
                    onPress: () => handleBackupKeys(keys.nsec)
                  }
                ]
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to generate keys');
            }
          }
        }
      ]
    );
  };

  const handleImportKeys = async () => {
    if (!keyInput.trim()) {
      Alert.alert('Error', 'Please enter your private key (nsec)');
      return;
    }

    setIsImporting(true);
    try {
      const nostrService = NostrService.getInstance();
      const keys = nostrService.importPrivateKey(keyInput.trim());
      
      if (!keys) {
        Alert.alert('Error', 'Invalid private key format');
        return;
      }

      dispatch(setKeys(keys));
      
      // Initialize with imported keys
      const settings = {
        privateKey: keys.privateKey,
        relays: nostrState.relays,
      };
      
      await dispatch(initializeNostr(settings) as any);
      
      setShowKeyImport(false);
      setKeyInput('');
      
      Alert.alert('Success', 'Keys imported successfully');
      
      // Load profile
      await dispatch(loadNostrProfile() as any);
    } catch (error) {
      Alert.alert('Error', 'Failed to import keys');
    } finally {
      setIsImporting(false);
    }
  };

  const handleBackupKeys = async (nsecKey?: string) => {
    const keyToBackup = nsecKey || nsec;
    if (!keyToBackup) {
      Alert.alert('Error', 'No private key to backup');
      return;
    }

    Alert.alert(
      'Backup Options',
      'Choose how you want to backup your private key',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Copy to Clipboard', 
          onPress: () => {
            Clipboard.setString(keyToBackup);
            Alert.alert('Copied', 'Private key copied to clipboard. Store it safely!');
          }
        },
        { 
          text: 'Share', 
          onPress: async () => {
            try {
              await Share.share({
                message: `My Nostr private key: ${keyToBackup}\n\nKeep this safe and never share it publicly!`,
                title: 'Nostr Private Key Backup',
              });
            } catch (error) {
              console.error('Failed to share key:', error);
            }
          }
        }
      ]
    );
  };

  const handleUpdateProfile = async () => {
    if (!isConnected) {
      Alert.alert('Error', 'Not connected to Nostr');
      return;
    }

    try {
      await dispatch(updateNostrProfile(profileForm) as any);
      setShowProfileEdit(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      Alert.alert('Error', 'Failed to update profile');
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect from Nostr',
      'This will clear your keys and disconnect from the Nostr network. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Disconnect', 
          style: 'destructive',
          onPress: async () => {
            try {
              const nostrService = NostrService.getInstance();
              await nostrService.disconnect();
              dispatch(clearKeys());
              dispatch(setConnected(false));
              Alert.alert('Disconnected', 'You have been disconnected from Nostr');
            } catch (error) {
              console.error('Failed to disconnect:', error);
            }
          }
        }
      ]
    );
  };

  const renderConnectionStatus = () => (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.statusIndicator}>
          <View style={[
            styles.statusDot, 
            { backgroundColor: isConnected ? theme.colors.success[500] : theme.colors.error[500] }
          ]} />
          <Text style={styles.cardTitle}>
            {isConnected ? 'Connected to Nostr' : 'Not Connected'}
          </Text>
        </View>
        {error && (
          <TouchableOpacity onPress={() => dispatch(setError(null))}>
            <Ionicons name="close-circle" size={20} color={theme.colors.error[500]} />
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <Text style={styles.errorText}>{error}</Text>
      )}

      {!isConnected && !publicKey && (
        <View style={styles.setupActions}>
          <Text style={styles.setupDescription}>
            Get started with Nostr by generating new keys or importing existing ones
          </Text>
          <View style={styles.setupButtons}>
            <Button
              title="Generate New Keys"
              onPress={handleGenerateKeys}
              style={styles.setupButton}
              loading={isInitializing}
            />
            <Button
              title="Import Existing Keys"
              onPress={() => setShowKeyImport(true)}
              variant="ghost"
              style={styles.setupButton}
            />
          </View>
        </View>
      )}

      {publicKey && !isConnected && (
        <View style={styles.reconnectSection}>
          <Text style={styles.reconnectText}>
            You have keys but are not connected. Reconnect to use Nostr features.
          </Text>
          <Button
            title="Reconnect"
            onPress={async () => {
              const settings = { 
                privateKey: nostrState.privateKey!, 
                relays: nostrState.relays 
              };
              await dispatch(initializeNostr(settings) as any);
            }}
            loading={isInitializing}
          />
        </View>
      )}
    </Card>
  );

  const renderKeyImportForm = () => {
    if (!showKeyImport) return null;

    return (
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Import Private Key</Text>
          <TouchableOpacity onPress={() => setShowKeyImport(false)}>
            <Ionicons name="close" size={24} color={theme.colors.text.secondary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.importDescription}>
          Enter or paste your Nostr private key (nsec) to import your existing identity. Use the paste button to paste from clipboard.
        </Text>

        <View style={styles.keyInputContainer}>
          <Input
            label="Private Key (nsec)"
            placeholder="nsec1..."
            value={keyInput}
            onChangeText={setKeyInput}
            variant="outlined"
            secureTextEntry={!showKeyInput}
            multiline
            style={styles.keyInput}
          />
          <View style={styles.keyInputActions}>
            <TouchableOpacity
              style={styles.keyInputAction}
              onPress={async () => {
                try {
                  const text = await Clipboard.getString();
                  if (text) {
                    setKeyInput(text);
                  }
                } catch (error) {
                  console.error('Failed to paste:', error);
                }
              }}
            >
              <Ionicons name="clipboard-outline" size={20} color={theme.colors.primary[500]} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.keyInputAction}
              onPress={() => setShowKeyInput(!showKeyInput)}
            >
              <Ionicons 
                name={showKeyInput ? "eye-off-outline" : "eye-outline"} 
                size={20} 
                color={theme.colors.primary[500]} 
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.importActions}>
          <Button
            title="Cancel"
            onPress={() => setShowKeyImport(false)}
            variant="ghost"
            style={styles.importCancelButton}
          />
          <Button
            title={isImporting ? "Importing..." : "Import"}
            onPress={handleImportKeys}
            loading={isImporting}
            disabled={isImporting || !keyInput.trim()}
            style={styles.importSubmitButton}
          />
        </View>
      </Card>
    );
  };

  const renderIdentityInfo = () => {
    if (!publicKey) return null;

    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Your Nostr Identity</Text>
        
        <View style={styles.identityItem}>
          <Text style={styles.identityLabel}>Public Key (npub)</Text>
          <View style={styles.identityValueContainer}>
            <Text style={styles.identityValue} numberOfLines={1}>
              {npub}
            </Text>
            <TouchableOpacity 
              onPress={() => {
                if (npub) {
                  Clipboard.setString(npub);
                  Alert.alert('Copied', 'Public key copied to clipboard');
                }
              }}
            >
              <Ionicons name="copy-outline" size={20} color={theme.colors.primary[500]} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.identityActions}>
          <Button
            title="Backup Private Key"
            onPress={() => handleBackupKeys()}
            variant="ghost"
            size="sm"
            style={styles.identityButton}
          />
          <Button
            title="Share Profile"
            onPress={async () => {
              if (npub) {
                await Share.share({
                  message: `Follow me on Nostr: ${npub}`,
                  title: 'My Nostr Profile',
                });
              }
            }}
            variant="ghost"
            size="sm"
            style={styles.identityButton}
          />
        </View>
      </Card>
    );
  };

  const renderProfileSection = () => {
    if (!isConnected) return null;

    return (
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Profile</Text>
          <TouchableOpacity onPress={() => setShowProfileEdit(!showProfileEdit)}>
            <Ionicons 
              name={showProfileEdit ? "close" : "pencil"} 
              size={20} 
              color={theme.colors.primary[500]} 
            />
          </TouchableOpacity>
        </View>

        {!showProfileEdit ? (
          <View style={styles.profileDisplay}>
            {profile?.display_name && (
              <Text style={styles.profileDisplayName}>{profile.display_name}</Text>
            )}
            {profile?.name && profile.name !== profile.display_name && (
              <Text style={styles.profileName}>@{profile.name}</Text>
            )}
            {profile?.about && (
              <Text style={styles.profileAbout}>{profile.about}</Text>
            )}
            {profile?.website && (
              <Text style={styles.profileWebsite}>{profile.website}</Text>
            )}
            {profile?.lud16 && (
              <View style={styles.lightningAddress}>
                <Ionicons name="flash" size={16} color={theme.colors.warning[500]} />
                <Text style={styles.lightningAddressText}>{profile.lud16}</Text>
              </View>
            )}
            
            {!profile && (
              <View style={styles.noProfile}>
                <Text style={styles.noProfileText}>No profile set up yet</Text>
                <Button
                  title="Set Up Profile"
                  onPress={() => setShowProfileEdit(true)}
                  size="sm"
                />
              </View>
            )}
          </View>
        ) : (
          <View style={styles.profileEdit}>
            <Input
              label="Display Name"
              placeholder="Your display name"
              value={profileForm.display_name}
              onChangeText={(text) => setProfileForm(prev => ({ ...prev, display_name: text }))}
              variant="outlined"
              style={styles.profileInput}
            />
            
            <Input
              label="Username"
              placeholder="username (no spaces)"
              value={profileForm.name}
              onChangeText={(text) => setProfileForm(prev => ({ ...prev, name: text.replace(/\s/g, '') }))}
              variant="outlined"
              style={styles.profileInput}
            />
            
            <Input
              label="About"
              placeholder="Tell people about yourself"
              value={profileForm.about}
              onChangeText={(text) => setProfileForm(prev => ({ ...prev, about: text }))}
              variant="outlined"
              multiline
              numberOfLines={3}
              style={styles.profileInput}
            />
            
            <Input
              label="Website"
              placeholder="https://yourwebsite.com"
              value={profileForm.website}
              onChangeText={(text) => setProfileForm(prev => ({ ...prev, website: text }))}
              variant="outlined"
              style={styles.profileInput}
            />
            
            <Input
              label="Lightning Address"
              placeholder="you@wallet.com"
              value={profileForm.lud16}
              onChangeText={(text) => setProfileForm(prev => ({ ...prev, lud16: text }))}
              variant="outlined"
              style={styles.profileInput}
            />

            <View style={styles.profileActions}>
              <Button
                title="Cancel"
                onPress={() => setShowProfileEdit(false)}
                variant="ghost"
                style={styles.profileCancelButton}
              />
              <Button
                title={isProfileLoading ? "Saving..." : "Save Profile"}
                onPress={handleUpdateProfile}
                loading={isProfileLoading}
                disabled={isProfileLoading}
                style={styles.profileSaveButton}
              />
            </View>
          </View>
        )}
      </Card>
    );
  };

  const renderActions = () => {
    if (!isConnected) return null;

    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Actions</Text>
        
        <View style={styles.actionButtons}>
          <Button
            title="View Contacts"
            onPress={() => navigation?.navigate('NostrContacts')}
            variant="ghost"
            style={styles.actionButton}
          />
          <Button
            title="Disconnect"
            onPress={handleDisconnect}
            variant="ghost"
            style={styles.disconnectButton}
          />
        </View>
      </Card>
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {renderConnectionStatus()}
      {renderKeyImportForm()}
      {renderIdentityInfo()}
      {renderProfileSection()}
      {renderActions()}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  
  card: {
    marginBottom: theme.spacing[4],
  },
  
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  
  cardTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  
  errorText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[600],
    marginBottom: theme.spacing[3],
  },
  
  setupActions: {
    alignItems: 'center',
  },
  
  setupDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[4],
    lineHeight: 22,
  },
  
  setupButtons: {
    width: '100%',
    gap: theme.spacing[3],
  },
  
  setupButton: {
    width: '100%',
  },
  
  reconnectSection: {
    alignItems: 'center',
  },
  
  reconnectText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[4],
  },
  
  importDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[4],
    lineHeight: 20,
  },
  
  keyInputContainer: {
    position: 'relative',
    marginBottom: theme.spacing[4],
  },

  keyInput: {
    marginBottom: 0,
  },

  keyInputActions: {
    position: 'absolute',
    right: theme.spacing[3],
    top: '50%',
    transform: [{ translateY: -10 }],
    flexDirection: 'row',
    gap: theme.spacing[2],
  },

  keyInputAction: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  importActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  
  importCancelButton: {
    flex: 1,
  },
  
  importSubmitButton: {
    flex: 1,
  },
  
  identityItem: {
    marginBottom: theme.spacing[4],
  },
  
  identityLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },
  
  identityValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.base,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  
  identityValue: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
  },
  
  identityActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  
  identityButton: {
    flex: 1,
  },
  
  profileDisplay: {
    gap: theme.spacing[2],
  },
  
  profileDisplayName: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  profileName: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  
  profileAbout: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    lineHeight: 22,
  },
  
  profileWebsite: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.primary[500],
  },
  
  lightningAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.warning[50],
    padding: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  
  lightningAddressText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning[600],
    fontWeight: '500',
  },
  
  noProfile: {
    alignItems: 'center',
    paddingVertical: theme.spacing[4],
  },
  
  noProfileText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.muted,
    marginBottom: theme.spacing[3],
  },
  
  profileEdit: {
    gap: theme.spacing[4],
  },
  
  profileInput: {
    marginBottom: 0,
  },
  
  profileActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  
  profileCancelButton: {
    flex: 1,
  },
  
  profileSaveButton: {
    flex: 1,
  },
  
  actionButtons: {
    gap: theme.spacing[3],
  },
  
  actionButton: {
    width: '100%',
  },
  
  disconnectButton: {
    borderColor: theme.colors.error[500],
  },
}); 