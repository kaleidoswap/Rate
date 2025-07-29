// screens/SettingsScreen.tsx
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch, TextInput, Alert, Text, TouchableOpacity } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import { 
  setTheme, 
  setCurrency, 
  setLanguage, 
  setNetwork,
  setBiometricEnabled,
  setPinEnabled,
  setAutoLockTimeout,
  setNotifications,
  setTransactionNotifications,
  setPriceAlerts,
  setHideBalances,
  setNodeType,
  setRemoteNodeUrl,
} from '../store/slices/settingsSlice';
import { setWalletConnectEnabled } from '../store/slices/nostrSlice';
import { RGBNodeService } from '../services/RGBNodeService';
import { Button, ListItem, Input } from '../components';
import NostrProfileManager from '../components/NostrProfileManager';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../theme';

interface Props {
  navigation: any;
}

export default function SettingsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);
  const nostrState = useSelector((state: RootState) => state.nostr);
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [tempNodeUrl, setTempNodeUrl] = useState(settings.remoteNodeUrl);
  const [showNostrSection, setShowNostrSection] = useState(false);

  const handleNodeTypeChange = async (useRemoteNode: boolean) => {
    const newType = useRemoteNode ? 'remote' : 'local';
    
    try {
      dispatch(setNodeType(newType));
      
      // TODO: Implement node configuration update when available
      Alert.alert(
        'Node Type Changed',
        `Switched to ${newType} node. You may need to restart the app for changes to take effect.`,
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert(
        'Error',
        'Failed to update node configuration. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleNodeUrlSave = async () => {
    if (!tempNodeUrl) {
      Alert.alert('Error', 'Node URL cannot be empty');
      return;
    }

    try {
      dispatch(setRemoteNodeUrl(tempNodeUrl));
      setIsEditingUrl(false);
      
      Alert.alert(
        'Node URL Updated',
        'Node URL has been updated. You may need to restart the app for changes to take effect.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert(
        'Error',
        'Failed to update node URL. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

  const handleWalletConnectToggle = (enabled: boolean) => {
    if (enabled && !nostrState.isConnected) {
      Alert.alert(
        'Nostr Connection Required',
        'You need to connect to Nostr first before enabling Wallet Connect',
        [{ text: 'OK' }]
      );
      return;
    }
    
    if (enabled) {
      Alert.alert(
        'Enable Nostr Wallet Connect',
        'Go to your Nostr profile settings to generate a connection string and configure NWC.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Go to Profile',
            onPress: () => {
              dispatch(setWalletConnectEnabled(enabled));
              // Navigate to nostr profile (this would need navigation prop passed to settings)
              // For now, just enable it
            }
          }
        ]
      );
    } else {
      // Disable directly
      dispatch(setWalletConnectEnabled(enabled));
    }
  };

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={theme.colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.placeholder} />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Nostr Section */}
        <View style={styles.section}>
          <TouchableOpacity 
            style={styles.sectionHeader}
            onPress={() => setShowNostrSection(!showNostrSection)}
          >
            <View style={styles.sectionTitleContainer}>
              <Ionicons 
                name="planet-outline" 
                size={24} 
                color={theme.colors.primary[500]} 
                style={styles.sectionIcon}
              />
              <Text style={styles.sectionTitle}>Nostr</Text>
              <View style={styles.statusBadge}>
                <View style={[
                  styles.statusDot,
                  { backgroundColor: nostrState.isConnected ? theme.colors.success[500] : theme.colors.gray[400] }
                ]} />
                <Text style={styles.statusText}>
                  {nostrState.isConnected ? 'Connected' : 'Disconnected'}
                </Text>
              </View>
            </View>
            <Ionicons 
              name={showNostrSection ? "chevron-up" : "chevron-down"} 
              size={20} 
              color={theme.colors.text.secondary} 
            />
          </TouchableOpacity>
          
          {showNostrSection && (
            <View style={styles.sectionContent}>
              <NostrProfileManager navigation={navigation} />
              
              {/* Nostr Wallet Connect */}
              <View style={styles.walletConnectSection}>
                <View style={styles.featureHeader}>
                  <View style={styles.featureInfo}>
                    <Text style={styles.featureTitle}>Nostr Wallet Connect</Text>
                    <Text style={styles.featureDescription}>
                      Share your wallet with other applications via NWC protocol
                    </Text>
                  </View>
                  <Switch
                    value={nostrState.walletConnectEnabled}
                    onValueChange={handleWalletConnectToggle}
                    disabled={!nostrState.isConnected}
                  />
                </View>
                
                {nostrState.walletConnectEnabled && (
                  <View style={styles.walletConnectInfo}>
                    <Text style={styles.walletConnectInfoText}>
                      ✅ Nostr Wallet Connect is active. You can now:
                    </Text>
                    <Text style={styles.walletConnectFeature}>• Generate connection strings for other apps</Text>
                    <Text style={styles.walletConnectFeature}>• Allow external wallets to make payments</Text>
                    <Text style={styles.walletConnectFeature}>• Manage NWC connections in your Nostr profile</Text>
                    {nostrState.nwcConnectionString && (
                      <Text style={styles.walletConnectFeature}>• Active connection string available</Text>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        {/* Node Settings */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Ionicons 
                name="server-outline" 
                size={24} 
                color={theme.colors.primary[500]} 
                style={styles.sectionIcon}
              />
              <Text style={styles.sectionTitle}>RGB Node Settings</Text>
            </View>
          </View>
          
          <View style={styles.sectionContent}>
            <ListItem>
              <Text>Use Remote Node</Text>
              <Switch
                value={settings.nodeType === 'remote'}
                onValueChange={(value) => handleNodeTypeChange(value)}
              />
            </ListItem>

            {settings.nodeType === 'remote' && (
              <ListItem>
                <View style={styles.nodeUrlContainer}>
                  <Text>Node URL</Text>
                  {isEditingUrl ? (
                    <View style={styles.urlEditContainer}>
                      <Input
                        value={tempNodeUrl}
                        onChangeText={setTempNodeUrl}
                        placeholder="Enter node URL"
                        style={styles.urlInput}
                      />
                      <View style={styles.urlButtons}>
                        <Button
                          title="Save"
                          onPress={handleNodeUrlSave}
                          style={styles.urlButton}
                        />
                        <Button
                          title="Cancel"
                          onPress={() => {
                            setTempNodeUrl(settings.remoteNodeUrl);
                            setIsEditingUrl(false);
                          }}
                          style={styles.cancelButton}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.urlViewContainer}>
                      <Text style={styles.urlText} numberOfLines={1}>
                        {settings.remoteNodeUrl}
                      </Text>
                      <Button
                        title="Edit"
                        onPress={() => setIsEditingUrl(true)}
                        style={styles.editButton}
                      />
                    </View>
                  )}
                </View>
              </ListItem>
            )}
          </View>
        </View>

        {/* Other Settings Sections */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Ionicons 
                name="settings-outline" 
                size={24} 
                color={theme.colors.primary[500]} 
                style={styles.sectionIcon}
              />
              <Text style={styles.sectionTitle}>General Settings</Text>
            </View>
          </View>
          
          <View style={styles.sectionContent}>
            <ListItem>
              <Text>Theme</Text>
              <Text style={styles.settingValue}>{settings.theme}</Text>
            </ListItem>
            
            <ListItem>
              <Text>Currency</Text>
              <Text style={styles.settingValue}>{settings.currency}</Text>
            </ListItem>
            
            <ListItem>
              <Text>Network</Text>
              <Text style={styles.settingValue}>{settings.network}</Text>
            </ListItem>
          </View>
        </View>
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
    backgroundColor: theme.colors.surface.primary,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
  },
  
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  placeholder: {
    width: 40,
  },

  scrollView: {
    flex: 1,
    paddingHorizontal: theme.spacing[5],
  },
  
  section: {
    marginBottom: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  
  sectionIcon: {
    marginRight: theme.spacing[3],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    flex: 1,
  },
  
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.gray[100],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
    marginLeft: theme.spacing[2],
  },
  
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: theme.spacing[2],
  },
  
  statusText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  
  sectionContent: {
    padding: theme.spacing[4],
  },
  
  walletConnectSection: {
    marginTop: theme.spacing[4],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  
  featureHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing[3],
  },
  
  featureInfo: {
    flex: 1,
    marginRight: theme.spacing[4],
  },
  
  featureTitle: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[1],
  },
  
  featureDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    lineHeight: 18,
  },
  
     walletConnectInfo: {
     marginTop: theme.spacing[3],
     paddingTop: theme.spacing[3],
     borderTopWidth: 1,
     borderTopColor: theme.colors.primary[100],
   },
  
  walletConnectInfoText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[2],
    fontWeight: '500',
  },
  
  walletConnectFeature: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    marginBottom: theme.spacing[1],
    lineHeight: 18,
  },
  
  settingValue: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textTransform: 'capitalize',
  },
  
  nodeUrlContainer: {
    flex: 1,
  },
  
  urlEditContainer: {
    marginTop: theme.spacing[2],
  },
  
  urlInput: {
    marginVertical: theme.spacing[2],
  },
  
  urlButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: theme.spacing[2],
  },
  
  urlButton: {
    minWidth: 80,
  },
  
     cancelButton: {
     backgroundColor: theme.colors.gray[400],
     minWidth: 80,
   },
  
  urlViewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing[2],
  },
  
  urlText: {
    flex: 1,
    marginRight: theme.spacing[2],
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  editButton: {
    minWidth: 60,
  },
});