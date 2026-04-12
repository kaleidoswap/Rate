// screens/SettingsScreen.tsx
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch, TextInput, Alert, Text, TouchableOpacity } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { NetworkIcon } from '../components/NetworkIcon';
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
  setBitcoinUnit,
} from '../store/slices/settingsSlice';
import { setWalletConnectEnabled } from '../store/slices/nostrSlice';
import { setActiveWallet } from '../store/slices/walletSlice';
import { Button, ListItem, Input, MainHeader } from '../components';
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

  const handleBitcoinUnitChange = (unit: 'BTC' | 'sats') => {
    dispatch(setBitcoinUnit(unit));
  };

  const handleThemeChange = () => {
    const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(settings.theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    dispatch(setTheme(nextTheme));
  };

  const handleCurrencyChange = () => {
    const currencies = ['USD', 'EUR', 'GBP'];
    const currentIndex = currencies.indexOf(settings.currency);
    const nextCurrency = currencies[(currentIndex + 1) % currencies.length];
    dispatch(setCurrency(nextCurrency));
  };

  const handleNetworkChange = () => {
    const networks = ['mainnet', 'testnet', 'regtest'];
    const currentIndex = networks.indexOf(settings.network);
    const nextNetwork = networks[(currentIndex + 1) % networks.length];
    dispatch(setNetwork(nextNetwork));
  };

  return (
    <View style={styles.container}>
      <MainHeader
        title="Settings"
        onBack={() => navigation.goBack()}
      />
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

        {/* General Settings Section */}
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
              <Text>Bitcoin Unit</Text>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => handleBitcoinUnitChange(settings.bitcoinUnit === 'BTC' ? 'sats' : 'BTC')}
              >
                <Text style={[styles.settingValue, styles.clickableValue]}>
                  {settings.bitcoinUnit}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={theme.colors.text.secondary}
                  style={styles.settingIcon}
                />
              </TouchableOpacity>
            </ListItem>

            <ListItem>
              <Text>Theme</Text>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleThemeChange}
              >
                <Text style={[styles.settingValue, styles.clickableValue]}>
                  {settings.theme}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={theme.colors.text.secondary}
                  style={styles.settingIcon}
                />
              </TouchableOpacity>
            </ListItem>

            <ListItem>
              <Text>Currency</Text>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleCurrencyChange}
              >
                <Text style={[styles.settingValue, styles.clickableValue]}>
                  {settings.currency}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={theme.colors.text.secondary}
                  style={styles.settingIcon}
                />
              </TouchableOpacity>
            </ListItem>

            <ListItem>
              <Text>Network</Text>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleNetworkChange}
              >
                <Text style={[styles.settingValue, styles.clickableValue]}>
                  {settings.network}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={theme.colors.text.secondary}
                  style={styles.settingIcon}
                />
              </TouchableOpacity>
            </ListItem>
          </View>
        </View>

        {/* Wallet Protocols */}
        <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text.tertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Wallet Protocols
          </Text>
          <View style={{ backgroundColor: theme.colors.background.primary, borderRadius: 12, padding: 14 }}>
            {(['RGB', 'SPARK', 'ARKADE'] as const).map((proto, idx) => {
              const { protocolManager: pm } = require('../services/protocols');
              const adapter = pm.getAdapterIfAvailable(proto);
              const connected = adapter?.isConnected() ?? false;
              const colors: Record<string, string> = { RGB: '#2BEE79', SPARK: '#60A5FA', ARKADE: '#A855F7' };
              const labels: Record<string, string> = { RGB: 'RGB Lightning', SPARK: 'Spark', ARKADE: 'Arkade' };
              const descs: Record<string, string> = {
                RGB: 'On-chain, Lightning, RGB assets',
                SPARK: 'Spark L2 Bitcoin + tokens',
                ARKADE: 'Off-chain Bitcoin (VTXOs)',
              };
              return (
                <View key={proto} style={{
                  flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                  borderTopWidth: idx > 0 ? StyleSheet.hairlineWidth : 0,
                  borderTopColor: theme.colors.gray[200],
                }}>
                  <View style={{ marginRight: 12, opacity: connected ? 1 : 0.3 }}>
                    <NetworkIcon network={proto} size={22} color={colors[proto]} />
                  </View>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: theme.colors.text.primary }}>{labels[proto]}</Text>
                    <Text style={{ fontSize: 12, color: theme.colors.text.tertiary, marginTop: 2 }} numberOfLines={1}>{descs[proto]}</Text>
                  </View>
                  <Text style={{
                    fontSize: 12, fontWeight: '600',
                    color: connected ? colors[proto] : theme.colors.gray[400],
                  }}>
                    {connected ? 'Connected' : 'Offline'}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Danger Zone */}
        <View style={{ marginTop: 24, paddingHorizontal: 16, marginBottom: 40 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.error[500], textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Danger Zone
          </Text>
          <View style={{ backgroundColor: theme.colors.background.primary, borderRadius: 12, overflow: 'hidden' }}>
            <TouchableOpacity
              style={[styles.settingRow, { paddingVertical: 14 }]}
              onPress={() => {
                Alert.alert(
                  'Remove Wallet',
                  'This will delete your wallet data from this device. Make sure you have backed up your mnemonic phrase before proceeding.\n\nThis action cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove Wallet',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const { protocolManager } = require('../services/protocols');
                          await protocolManager.disconnectAll();
                          const DatabaseService = require('../services/DatabaseService').default;
                          const db = DatabaseService.getInstance();
                          const activeWallet = await db.getActiveWallet();
                          if (activeWallet?.id) {
                            await db.deleteWallet(activeWallet.id);
                          }
                          dispatch(setActiveWallet(null as any));
                          Alert.alert('Wallet Removed', 'You can now create or import a new wallet.');
                          navigation.reset({ index: 0, routes: [{ name: 'InitialLoad' as any }] });
                        } catch (err: any) {
                          Alert.alert('Error', err.message || 'Failed to remove wallet');
                        }
                      },
                    },
                  ]
                );
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="trash-outline" size={20} color={theme.colors.error[500]} style={{ marginRight: 12 }} />
                <Text style={{ color: theme.colors.error[500], fontSize: 16, fontWeight: '600' }}>Remove Wallet</Text>
              </View>
              <Text style={{ color: theme.colors.text.tertiary, fontSize: 12, marginTop: 4 }}>
                Delete wallet and start fresh
              </Text>
            </TouchableOpacity>
          </View>
        </View>
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
  unitSelector: {
    backgroundColor: theme.colors.background.secondary,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clickableValue: {
    color: theme.colors.primary[500],
  },
  settingIcon: {
    marginLeft: theme.spacing[2],
  },
});