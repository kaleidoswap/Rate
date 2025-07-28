// screens/SettingsScreen.tsx
import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Switch, TextInput, Alert, Text } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
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
import { RGBNodeService } from '../services/RGBNodeService';
import { Button, ListItem, Input } from '../components';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Props {
  navigation: any;
}

export default function SettingsScreen({ navigation }: Props) {
  const dispatch = useDispatch();
  const settings = useSelector((state: RootState) => state.settings);
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [tempNodeUrl, setTempNodeUrl] = useState(settings.remoteNodeUrl);

  const handleNodeTypeChange = async (useRemoteNode: boolean) => {
    const newType = useRemoteNode ? 'remote' : 'local';
    
    try {
      const nodeService = RGBNodeService.getInstance();
      await nodeService.updateNodeConfig({
        nodeType: newType,
        remoteNodeUrl: useRemoteNode ? settings.remoteNodeUrl : undefined,
      });
      
      dispatch(setNodeType(newType));
      
      // Reinitialize the node with new configuration
      const success = await nodeService.initializeNode();
      if (!success) {
        throw new Error('Failed to initialize node with new configuration');
      }
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
      const nodeService = RGBNodeService.getInstance();
      await nodeService.updateNodeConfig({
        nodeType: 'remote',
        remoteNodeUrl: tempNodeUrl,
      });
      
      dispatch(setRemoteNodeUrl(tempNodeUrl));
      setIsEditingUrl(false);
      
      // Test the connection
      const success = await nodeService.initializeNode();
      if (!success) {
        throw new Error('Failed to connect to the remote node');
      }
    } catch (error) {
      Alert.alert(
        'Error',
        'Failed to connect to the remote node. Please check the URL and try again.',
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <ScrollView style={styles.container}>
      {/* Wallet Info */}
      {/* Preferences */}
      {/* Security */}
      {/* Backup & Recovery */}
      {/* Advanced */}
      
      <SafeAreaView style={styles.section}>
        <Text style={styles.sectionTitle}>Node Settings</Text>
        
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
                      style={[styles.urlButton, styles.cancelButton]}
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
      </SafeAreaView>

      {/* Danger Zone */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  nodeUrlContainer: {
    flex: 1,
  },
  urlEditContainer: {
    marginTop: 8,
  },
  urlInput: {
    marginVertical: 8,
  },
  urlButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  urlButton: {
    minWidth: 80,
  },
  cancelButton: {
    backgroundColor: '#ccc',
  },
  urlViewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  urlText: {
    flex: 1,
    marginRight: 8,
  },
  editButton: {
    minWidth: 60,
  },
});