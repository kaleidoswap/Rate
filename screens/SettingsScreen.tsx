// screens/SettingsScreen.tsx
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch, TextInput, Alert, Text, TouchableOpacity } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
      console.error('Failed to change node type:', error);
      Alert.alert('Error', 'Failed to change node type. Please try again.');
    }
  };

  const handleNodeUrlSave = () => {
    if (!tempNodeUrl.trim()) {
      Alert.alert('Error', 'Please enter a valid node URL');
      return;
    }

    try {
      const url = new URL(tempNodeUrl);
      dispatch(setRemoteNodeUrl(tempNodeUrl));
      setIsEditingUrl(false);
      Alert.alert(
        'Node URL Updated',
        'The remote node URL has been updated. You may need to restart the app for changes to take effect.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      Alert.alert('Error', 'Please enter a valid URL (e.g., https://example.com:3000)');
    }
  };

  const handleBiometricToggle = (enabled: boolean) => {
    dispatch(setBiometricEnabled(enabled));
  };

  const handlePinToggle = (enabled: boolean) => {
    dispatch(setPinEnabled(enabled));
  };

  const handleAutoLockChange = (timeout: number) => {
    dispatch(setAutoLockTimeout(timeout));
  };

  const handleNotificationsToggle = (enabled: boolean) => {
    dispatch(setNotifications(enabled));
  };

  const handleTransactionNotificationsToggle = (enabled: boolean) => {
    dispatch(setTransactionNotifications(enabled));
  };

  const handlePriceAlertsToggle = (enabled: boolean) => {
    dispatch(setPriceAlerts(enabled));
  };

  const handleHideBalancesToggle = (enabled: boolean) => {
    dispatch(setHideBalances(enabled));
  };

  const handleWalletConnectToggle = (enabled: boolean) => {
    dispatch(setWalletConnectEnabled(enabled));
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Drawer Header */}
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View style={styles.headerIcon}>
              <Ionicons name="settings" size={24} color="white" />
            </View>
            <Text style={styles.headerTitle}>Settings</Text>
          </View>
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={() => navigation.closeDrawer()}
          >
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </LinearGradient>

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
                      Connect external wallets via NWC protocol (Coming Soon)
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
                      🚧 This feature is under development. It will allow you to:
                    </Text>
                    <Text style={styles.walletConnectFeature}>• Connect to Alby, Mutiny, and other NWC wallets</Text>
                    <Text style={styles.walletConnectFeature}>• Make Lightning payments through connected wallets</Text>
                    <Text style={styles.walletConnectFeature}>• Manage multiple wallet connections</Text>
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

  headerGradient: {
    paddingTop: theme.spacing[5],
    paddingBottom: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  headerIcon: {
    marginRight: theme.spacing[3],
  },

  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: 'bold',
    color: 'white',
  },

  closeButton: {
    padding: theme.spacing[2],
  },
});