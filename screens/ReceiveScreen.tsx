// screens/ReceiveScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Share,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Picker } from '@react-native-picker/picker';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';

interface Props {
  navigation: any;
}

type ReceiveType = 'bitcoin' | 'rgb' | 'lightning';

export default function ReceiveScreen({ navigation }: Props) {
  const { rgbAssets } = useSelector((state: RootState) => state.wallet);
  const [receiveType, setReceiveType] = useState<ReceiveType>('bitcoin');
  const [address, setAddress] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const apiService = RGBApiService.getInstance();

  useEffect(() => {
    generateAddress();
  }, [receiveType, selectedAsset]);

  const generateAddress = async () => {
    if (loading) return;
    
    setLoading(true);
    try {
      if (receiveType === 'bitcoin') {
        const result = await apiService.getNewAddress();
        setAddress(result.address);
      } else if (receiveType === 'rgb') {
        const result = await apiService.createRgbInvoice(selectedAsset || undefined);
        setAddress(result.invoice);
      } else if (receiveType === 'lightning') {
        const amountMsat = amount ? parseFloat(amount) * 100000000000 : undefined;
        const result = await apiService.createLnInvoice(amountMsat, selectedAsset, amount ? parseFloat(amount) : undefined);
        setAddress(result.invoice);
      }
    } catch (error) {
      console.error('Failed to generate address:', error);
      Alert.alert('Error', 'Failed to generate address');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(address);
    Alert.alert('Copied', 'Address copied to clipboard');
  };

  const shareAddress = async () => {
    try {
      await Share.share({
        message: address,
        title: `${receiveType === 'bitcoin' ? 'Bitcoin' : receiveType === 'rgb' ? 'RGB' : 'Lightning'} Address`,
      });
    } catch (error) {
      console.error('Failed to share:', error);
    }
  };

  const renderReceiveTypeSelector = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Receive Type</Text>
      <View style={styles.receiveTypeButtons}>
        <TouchableOpacity
          style={[styles.receiveTypeButton, receiveType === 'bitcoin' && styles.receiveTypeButtonActive]}
          onPress={() => setReceiveType('bitcoin')}
        >
          <Text style={[styles.receiveTypeButtonText, receiveType === 'bitcoin' && styles.receiveTypeButtonTextActive]}>
            Bitcoin
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.receiveTypeButton, receiveType === 'rgb' && styles.receiveTypeButtonActive]}
          onPress={() => setReceiveType('rgb')}
        >
          <Text style={[styles.receiveTypeButtonText, receiveType === 'rgb' && styles.receiveTypeButtonTextActive]}>
            RGB Asset
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.receiveTypeButton, receiveType === 'lightning' && styles.receiveTypeButtonActive]}
          onPress={() => setReceiveType('lightning')}
        >
          <Text style={[styles.receiveTypeButtonText, receiveType === 'lightning' && styles.receiveTypeButtonTextActive]}>
            Lightning
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderAssetSelector = () => {
    if (receiveType !== 'rgb' && receiveType !== 'lightning') return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {receiveType === 'rgb' ? 'RGB Asset (Optional)' : 'RGB Asset for Invoice'}
        </Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={selectedAsset}
            onValueChange={setSelectedAsset}
            style={styles.picker}
          >
            <Picker.Item label="Any asset" value="" />
            {rgbAssets.map((asset) => (
              <Picker.Item
                key={asset.asset_id}
                label={`${asset.ticker} - ${asset.name}`}
                value={asset.asset_id}
              />
            ))}
          </Picker>
        </View>
      </View>
    );
  };

  const renderQRCode = () => {
    if (!address) return null;

    return (
      <View style={styles.qrSection}>
        <View style={styles.qrContainer}>
          <QRCode
            value={address}
            size={200}
            backgroundColor="white"
            color="black"
          />
        </View>
        
        <View style={styles.addressContainer}>
          <Text style={styles.addressLabel}>
            {receiveType === 'bitcoin' ? 'Bitcoin Address' : 
             receiveType === 'rgb' ? 'RGB Invoice' : 'Lightning Invoice'}
          </Text>
          <Text style={styles.addressText} numberOfLines={3}>
            {address}
          </Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.actionButton} onPress={copyToClipboard}>
            <Ionicons name="copy" size={20} color="#007AFF" />
            <Text style={styles.actionButtonText}>Copy</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={shareAddress}>
            <Ionicons name="share" size={20} color="#007AFF" />
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.actionButton} onPress={generateAddress}>
            <Ionicons name="refresh" size={20} color="#007AFF" />
            <Text style={styles.actionButtonText}>New</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Receive</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scrollView}>
        {renderReceiveTypeSelector()}
        {renderAssetSelector()}
        {renderQRCode()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  sendTypeButtons: {
    flexDirection: 'row',
    borderRadius: 10,
    backgroundColor: 'white',
    padding: 4,
  },
  sendTypeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  sendTypeButtonActive: {
    backgroundColor: '#007AFF',
  },
  sendTypeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  sendTypeButtonTextActive: {
    color: 'white',
  },
  receiveTypeButtons: {
    flexDirection: 'row',
    borderRadius: 10,
    backgroundColor: 'white',
    padding: 4,
  },
  receiveTypeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  receiveTypeButtonActive: {
    backgroundColor: '#007AFF',
  },
  receiveTypeButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  receiveTypeButtonTextActive: {
    color: 'white',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  textInput: {
    flex: 1,
    paddingVertical: 15,
    fontSize: 16,
    color: '#333',
  },
  scanButton: {
    padding: 8,
  },
  maxButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  maxButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  balanceText: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
  },
  feeEstimate: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 5,
  },
  pickerContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  picker: {
    height: 50,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 40,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  qrSection: {
    alignItems: 'center',
    marginTop: 20,
  },
  qrContainer: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  addressContainer: {
    marginTop: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 15,
    width: '100%',
  },
  addressLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  addressText: {
    fontSize: 12,
    color: '#333',
    fontFamily: 'monospace',
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 20,
    justifyContent: 'space-around',
    width: '100%',
  },
  actionButton: {
    alignItems: 'center',
    padding: 15,
  },
  actionButtonText: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 5,
    fontWeight: '500',
  },
});