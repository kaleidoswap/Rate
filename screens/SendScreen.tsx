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
import { LinearGradient } from 'expo-linear-gradient';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';
import { theme } from '../theme';
import { Card, Button, Input } from '../components';

interface Props {
  navigation: any;
  route: any;
}

type SendType = 'bitcoin' | 'rgb' | 'lightning';

interface RGBAsset {
  asset_id: string;
  ticker: string;
  name: string;
  balance: number;
  precision: number;
  spendable: number;
}

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

  const getMaxAmount = (): string => {
    if (sendType === 'bitcoin') {
      const availableBalance = btcBalance?.vanilla.spendable || 0;
      return (availableBalance / 100000000).toFixed(8);
    }

    if (sendType === 'rgb' && selectedAsset) {
      const asset = rgbAssets.find((a: RGBAsset) => a.asset_id === selectedAsset);
      return asset ? asset.balance.toFixed(asset.precision) : '0';
    }

    return '0';
  };

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
      const asset = rgbAssets.find((a: RGBAsset) => a.asset_id === selectedAsset);
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
        const result = await apiService.sendBitcoin({
          address,
          amount: parseFloat(amount),
          fee_rate: parseFloat(feeRate),
        });
        
        Alert.alert(
          'Success',
          `Bitcoin sent successfully!\nTXID: ${result.txid}`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else if (sendType === 'rgb') {
        const result = await apiService.sendRGBAsset({
          asset_id: selectedAsset,
          address,
          amount: parseFloat(amount),
        });
        
        Alert.alert(
          'Success',
          `RGB asset sent successfully!\nTXID: ${result.txid}`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else if (sendType === 'lightning') {
        const result = await apiService.payLightningInvoice({
          invoice: address,
        });
        
        Alert.alert(
          'Success',
          'Lightning payment sent successfully!',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      }
    } catch (error) {
      console.error('Send error:', error);
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to send payment'
      );
    } finally {
      setLoading(false);
    }
  };

  const renderHeader = () => (
    <LinearGradient
      colors={['#667eea', '#764ba2']}
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
        <Text style={styles.headerTitle}>Send Payment</Text>
        <View style={styles.headerSpacer} />
      </View>
    </LinearGradient>
  );

  const renderSendTypeSelector = () => (
    <Card style={styles.typeCard}>
      <Text style={styles.sectionTitle}>Payment Method</Text>
      <View style={styles.typeSelector}>
        <TouchableOpacity
          style={[
            styles.typeButton,
            sendType === 'bitcoin' && styles.typeButtonActive
          ]}
          onPress={() => setSendType('bitcoin')}
        >
          <View style={styles.typeButtonContent}>
            <Ionicons 
              name="logo-bitcoin" 
              size={20} 
              color={sendType === 'bitcoin' ? theme.colors.text.inverse : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.typeButtonText, 
              sendType === 'bitcoin' && styles.typeButtonTextActive
            ]}>
              Bitcoin
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.typeButton,
            sendType === 'rgb' && styles.typeButtonActive
          ]}
          onPress={() => setSendType('rgb')}
        >
          <View style={styles.typeButtonContent}>
            <Ionicons 
              name="diamond" 
              size={20} 
              color={sendType === 'rgb' ? theme.colors.text.inverse : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.typeButtonText, 
              sendType === 'rgb' && styles.typeButtonTextActive
            ]}>
              RGB Asset
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.typeButton,
            sendType === 'lightning' && styles.typeButtonActive
          ]}
          onPress={() => setSendType('lightning')}
        >
          <View style={styles.typeButtonContent}>
            <Ionicons 
              name="flash" 
              size={20} 
              color={sendType === 'lightning' ? theme.colors.text.inverse : theme.colors.text.secondary} 
            />
            <Text style={[
              styles.typeButtonText, 
              sendType === 'lightning' && styles.typeButtonTextActive
            ]}>
              Lightning
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </Card>
  );

  const renderRecipientInput = () => (
    <Card style={styles.inputCard}>
      <Text style={styles.sectionTitle}>
        {sendType === 'lightning' ? 'Lightning Invoice' : 'Recipient Address'}
      </Text>
      <View style={styles.inputRow}>
        <Input
          style={styles.addressInput}
          inputStyle={sendType === 'lightning' ? styles.multilineInput : undefined}
          placeholder={sendType === 'lightning' ? 'Paste Lightning invoice...' : 'Enter address...'}
          value={address}
          onChangeText={setAddress}
          multiline={sendType === 'lightning'}
          variant="outlined"
        />
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => navigation.navigate('QRScanner')}
        >
          <Ionicons name="qr-code" size={24} color={theme.colors.primary[500]} />
        </TouchableOpacity>
      </View>
    </Card>
  );

  const renderAssetSelector = () => {
    if (sendType !== 'rgb') return null;

    return (
      <Card style={styles.inputCard}>
        <Text style={styles.sectionTitle}>Select RGB Asset</Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={selectedAsset}
            onValueChange={setSelectedAsset}
            style={styles.picker}
          >
            <Picker.Item 
              label="Select an asset..." 
              value="" 
              color={theme.colors.text.muted}
            />
            {rgbAssets.map((asset: RGBAsset) => (
              <Picker.Item
                key={asset.asset_id}
                label={`${asset.ticker} - ${asset.name} (${asset.spendable})`}
                value={asset.asset_id}
                color={theme.colors.text.primary}
              />
            ))}
          </Picker>
        </View>
      </Card>
    );
  };

  const renderAmountInput = () => {
    if (sendType === 'lightning') return null;

    const asset = sendType === 'rgb' ? rgbAssets.find((a: RGBAsset) => a.asset_id === selectedAsset) : null;
    const unit = sendType === 'bitcoin' ? 'BTC' : asset?.ticker || '';
    const maxAmount = getMaxAmount();

    return (
      <Card style={styles.inputCard}>
        <View style={styles.amountHeader}>
          <Text style={styles.sectionTitle}>Amount ({unit})</Text>
          <TouchableOpacity
            style={styles.maxButton}
            onPress={() => setAmount(maxAmount)}
          >
            <Text style={styles.maxButtonText}>MAX</Text>
          </TouchableOpacity>
        </View>
        
        <Input
          style={styles.amountInput}
          placeholder="0.00000000"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          variant="outlined"
          size="lg"
        />
        
        <View style={styles.balanceInfo}>
          <Text style={styles.balanceText}>
            Available: {maxAmount} {unit}
          </Text>
          {sendType === 'bitcoin' && amount && (
            <Text style={styles.usdValue}>
              ≈ ${((parseFloat(amount) || 0) * 50000).toLocaleString()} USD
            </Text>
          )}
        </View>
      </Card>
    );
  };

  const renderFeeInput = () => {
    if (sendType === 'lightning') return null;

    return (
      <Card style={styles.inputCard}>
        <Text style={styles.sectionTitle}>Network Fee</Text>
        <Input
          label="Fee Rate (sat/vB)"
          placeholder="1"
          value={feeRate}
          onChangeText={setFeeRate}
          keyboardType="decimal-pad"
          variant="outlined"
        />
        {estimatedFee && (
          <View style={styles.feeInfo}>
            <Text style={styles.feeEstimate}>
              Estimated: {estimatedFee} sat/vB
            </Text>
          </View>
        )}
      </Card>
    );
  };

  const canSend = () => {
    if (!address || !address.trim()) return false;
    if (sendType !== 'lightning' && (!amount || parseFloat(amount) <= 0)) return false;
    if (sendType === 'rgb' && !selectedAsset) return false;
    return true;
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {renderSendTypeSelector()}
        {renderRecipientInput()}
        {renderAssetSelector()}
        {renderAmountInput()}
        {renderFeeInput()}

        <View style={styles.buttonContainer}>
          <Button
            title={loading ? 'Sending...' : 'Send Payment'}
            onPress={handleSend}
            disabled={loading || !canSend()}
            loading={loading}
            variant="primary"
            gradient={true}
            fullWidth={true}
            size="lg"
          />
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
  
  headerGradient: {
    paddingBottom: theme.spacing[4],
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
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  headerSpacer: {
    width: 40,
  },
  
  scrollView: {
    flex: 1,
    paddingHorizontal: theme.spacing[5],
  },
  
  typeCard: {
    marginTop: theme.spacing[5],
    marginBottom: theme.spacing[5],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[4],
  },
  
  typeSelector: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },
  
  typeButton: {
    flex: 1,
    backgroundColor: theme.colors.gray[100],
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[3],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  
  typeButtonActive: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[600],
  },
  
  typeButtonContent: {
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  
  typeButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  
  typeButtonTextActive: {
    color: theme.colors.text.inverse,
    fontWeight: '600',
  },
  
  inputCard: {
    marginBottom: theme.spacing[5],
  },
  
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
  },
  
  addressInput: {
    flex: 1,
  },
  
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: theme.spacing[4],
  },
  
  scanButton: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primary[50],
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing[8], // Align with input
  },
  
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface.primary,
  },
  
  picker: {
    height: 50,
    width: '100%',
  },
  
  amountHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  
  maxButton: {
    backgroundColor: theme.colors.secondary[50],
    borderWidth: 1,
    borderColor: theme.colors.secondary[100],
    borderRadius: theme.borderRadius.base,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  
  maxButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.secondary[600],
  },
  
  amountInput: {
    marginBottom: theme.spacing[3],
  },
  
  balanceInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  
  balanceText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  usdValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '500',
    color: theme.colors.text.primary,
  },
  
  feeInfo: {
    marginTop: theme.spacing[3],
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  
  feeEstimate: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.success[600],
    fontWeight: '500',
  },
  
  buttonContainer: {
    paddingVertical: theme.spacing[8],
  },
});

