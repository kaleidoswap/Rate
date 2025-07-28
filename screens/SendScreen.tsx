// screens/SendScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSelector } from 'react-redux';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';

interface Props {
  navigation: any;
  route: any;
}

type SendType = 'bitcoin' | 'rgb' | 'lightning';

export default function SendScreen({ navigation, route }: Props) {
  const { btcBalance, rgbAssets } = useSelector((state: RootState) => state.wallet);
  const [sendType, setSendType] = useState<SendType>('bitcoin');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('');
  const [feeRate, setFeeRate] = useState('1');
  const [loading, setLoading] = useState(false);
  const [estimatedFee, setEstimatedFee] = useState<number | null>(null);

  const apiService = RGBApiService.getInstance();

  useEffect(() => {
    // Pre-fill address if passed from QR scanner or other screens
    if (route.params?.address) {
      setAddress(route.params.address);
    }
    if (route.params?.assetId) {
      setSendType('rgb');
      setSelectedAsset(route.params.assetId);
    }
  }, [route.params]);

  const estimateFee = async () => {
    if (sendType === 'bitcoin' && amount) {
      try {
        const fee = await apiService.estimateFee({ blocks: 6 });
        setEstimatedFee(fee.fee_rate);
      } catch (error) {
        console.warn('Failed to estimate fee:', error);
      }
    }
  };

  useEffect(() => {
    estimateFee();
  }, [amount, sendType]);

  const validateInputs = (): boolean => {
    if (!address.trim()) {
      Alert.alert('Error', 'Please enter a recipient address');
      return false;
    }

    if (!amount.trim() || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return false;
    }

    if (sendType === 'rgb' && !selectedAsset) {
      Alert.alert('Error', 'Please select an RGB asset');
      return false;
    }

    if (sendType === 'bitcoin') {
      const amountSats = parseFloat(amount) * 100000000;
      const availableBalance = btcBalance?.vanilla.spendable || 0;
      if (amountSats > availableBalance) {
        Alert.alert('Error', 'Insufficient Bitcoin balance');
        return false;
      }
    }

    if (sendType === 'rgb') {
      const asset = rgbAssets.find(a => a.asset_id === selectedAsset);
      if (asset && parseFloat(amount) > asset.balance) {
        Alert.alert('Error', 'Insufficient asset balance');
        return false;
      }
    }

    return true;
  };

  const handleSend = async () => {
    if (!validateInputs()) return;

    setLoading(true);
    try {
      if (sendType === 'bitcoin') {
        await sendBitcoin();
      } else if (sendType === 'rgb') {
        await sendRGBAsset();
      } else if (sendType === 'lightning') {
        await sendLightning();
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert('Error', error.message || 'Failed to send transaction');
    } finally {
      setLoading(false);
    }
  };

  const sendBitcoin = async () => {
    const amountSats = Math.floor(parseFloat(amount) * 100000000);
    const result = await apiService.sendBtc(amountSats, address, parseFloat(feeRate));
    
    Alert.alert(
      'Transaction Sent',
      `Bitcoin sent successfully!\nTransaction ID: ${result.txid}`,
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const sendRGBAsset = async () => {
    const asset = rgbAssets.find(a => a.asset_id === selectedAsset);
    if (!asset) throw new Error('Asset not found');

    const scaledAmount = Math.floor(parseFloat(amount) * Math.pow(10, asset.precision));
    
    const result = await apiService.sendAsset({
      asset_id: selectedAsset,
      assignment: {
        type: 'Fungible',
        value: scaledAmount
      },
      recipient_id: address,
      fee_rate: parseFloat(feeRate),
      transport_endpoints: ['rpc://127.0.0.1:3000/json-rpc'],
      donation: false
    });

    Alert.alert(
      'RGB Asset Sent',
      `${amount} ${asset.ticker} sent successfully!\nTransaction ID: ${result.txid}`,
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const sendLightning = async () => {
    const result = await apiService.sendPayment({ invoice: address });
    
    Alert.alert(
      'Lightning Payment Sent',
      `Payment sent successfully!\nPayment Hash: ${result.payment_hash}`,
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const getMaxAmount = (): string => {
    if (sendType === 'bitcoin') {
      const availableBalance = btcBalance?.vanilla.spendable || 0;
      return (availableBalance / 100000000).toFixed(8);
    } else if (sendType === 'rgb' && selectedAsset) {
      const asset = rgbAssets.find(a => a.asset_id === selectedAsset);
      return asset ? asset.balance.toFixed(asset.precision) : '0';
    }
    return '0';
  };

  const renderSendTypeSelector = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Send Type</Text>
      <View style={styles.sendTypeButtons}>
        <TouchableOpacity
          style={[styles.sendTypeButton, sendType === 'bitcoin' && styles.sendTypeButtonActive]}
          onPress={() => setSendType('bitcoin')}
        >
          <Text style={[styles.sendTypeButtonText, sendType === 'bitcoin' && styles.sendTypeButtonTextActive]}>
            Bitcoin
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sendTypeButton, sendType === 'rgb' && styles.sendTypeButtonActive]}
          onPress={() => setSendType('rgb')}
        >
          <Text style={[styles.sendTypeButtonText, sendType === 'rgb' && styles.sendTypeButtonTextActive]}>
            RGB Asset
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sendTypeButton, sendType === 'lightning' && styles.sendTypeButtonActive]}
          onPress={() => setSendType('lightning')}
        >
          <Text style={[styles.sendTypeButtonText, sendType === 'lightning' && styles.sendTypeButtonTextActive]}>
            Lightning
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderRecipientInput = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        {sendType === 'lightning' ? 'Lightning Invoice' : 'Recipient Address'}
      </Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder={sendType === 'lightning' ? 'Paste Lightning invoice...' : 'Enter address...'}
          value={address}
          onChangeText={setAddress}
          multiline={sendType === 'lightning'}
          numberOfLines={sendType === 'lightning' ? 3 : 1}
        />
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => navigation.navigate('QRScanner')}
        >
          <Ionicons name="qr-code" size={20} color="#007AFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderAssetSelector = () => {
    if (sendType !== 'rgb') return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Select RGB Asset</Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={selectedAsset}
            onValueChange={setSelectedAsset}
            style={styles.picker}
          >
            <Picker.Item label="Select an asset..." value="" />
            {rgbAssets.map((asset) => (
              <Picker.Item
                key={asset.asset_id}
                label={`${asset.ticker} - ${asset.name} (${asset.balance})`}
                value={asset.asset_id}
              />
            ))}
          </Picker>
        </View>
      </View>
    );
  };

  const renderAmountInput = () => {
    if (sendType === 'lightning') return null;

    const asset = sendType === 'rgb' ? rgbAssets.find(a => a.asset_id === selectedAsset) : null;
    const unit = sendType === 'bitcoin' ? 'BTC' : asset?.ticker || '';

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Amount ({unit})</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="0.00000000"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <TouchableOpacity
            style={styles.maxButton}
            onPress={() => setAmount(getMaxAmount())}
          >
            <Text style={styles.maxButtonText}>MAX</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.balanceText}>
          Available: {getMaxAmount()} {unit}
        </Text>
      </View>
    );
  };

  const renderFeeInput = () => {
    if (sendType === 'lightning') return null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Fee Rate (sat/vB)</Text>
        <TextInput
          style={styles.textInput}
          placeholder="1"
          value={feeRate}
          onChangeText={setFeeRate}
          keyboardType="decimal-pad"
        />
        {estimatedFee && (
          <Text style={styles.feeEstimate}>
            Estimated: {estimatedFee} sat/vB
          </Text>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Send</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.scrollView}>
        {renderSendTypeSelector()}
        {renderRecipientInput()}
        {renderAssetSelector()}
        {renderAmountInput()}
        {renderFeeInput()}

        <TouchableOpacity
          style={[styles.sendButton, loading && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

