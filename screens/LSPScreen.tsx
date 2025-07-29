import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSelector, useDispatch } from 'react-redux';
import { theme } from '../theme';
import { Card, Button } from '../components';
import { RootState } from '../store';
import RGBApiService from '../services/RGBApiService';

interface Props {
  navigation: any;
}

interface LSPInfo {
  lsp_connection_url: string;
  options: {
    min_funding_confirms_within_blocks: number;
    min_required_channel_confirmations: number;
  };
  assets: Array<{
    asset_id: string;
    ticker: string;
    name: string;
    precision: number;
    min_channel_amount: number;
    max_channel_amount: number;
  }>;
}

export default function LSPScreen({ navigation }: Props) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [lspInfo, setLspInfo] = useState<LSPInfo | null>(null);
  const [connectionUrl, setConnectionUrl] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    capacitySat: '',
    clientBalanceSat: '',
    assetId: '',
    assetAmount: '',
    channelExpireBlocks: '144', // Default 24 hours
  });

  const settings = useSelector((state: RootState) => state.settings);
  const apiService = RGBApiService.getInstance();

  useEffect(() => {
    fetchLSPInfo();
  }, []);

  const fetchLSPInfo = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const info = await apiService.getLSPInfo();
      setLspInfo(info);
      setConnectionUrl(info.lsp_connection_url);
      await checkConnection(info.lsp_connection_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch LSP information');
      Alert.alert('Error', 'Failed to fetch LSP information');
    } finally {
      setIsLoading(false);
    }
  };

  const checkConnection = async (url: string) => {
    try {
      const pubkey = url.split('@')[0];
      const peers = await apiService.listPeers();
      setIsConnected(peers.some(peer => peer.pubkey === pubkey));
    } catch (err) {
      console.error('Failed to check peer connection:', err);
    }
  };

  const handleConnect = async () => {
    try {
      setIsLoading(true);
      await apiService.connectPeer(connectionUrl);
      setIsConnected(true);
      Alert.alert('Success', 'Connected to LSP successfully');
      setStep(2);
    } catch (err) {
      Alert.alert('Error', 'Failed to connect to LSP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateOrder = async () => {
    try {
      setIsLoading(true);
      const nodeInfo = await apiService.getNodeInfo();
      const address = await apiService.getNewAddress();

      const payload = {
        announce_channel: true,
        channel_expiry_blocks: parseInt(formData.channelExpireBlocks),
        client_balance_sat: parseInt(formData.clientBalanceSat),
        client_pubkey: nodeInfo.pubkey,
        funding_confirms_within_blocks: lspInfo?.options.min_funding_confirms_within_blocks || 1,
        lsp_balance_sat: parseInt(formData.capacitySat) - parseInt(formData.clientBalanceSat),
        refund_onchain_address: address,
        required_channel_confirmations: lspInfo?.options.min_required_channel_confirmations || 3,
      };

      if (formData.assetId && formData.assetAmount) {
        payload.asset_id = formData.assetId;
        payload.lsp_asset_amount = parseInt(formData.assetAmount);
        payload.client_asset_amount = 0;
      }

      const order = await apiService.createChannelOrder(payload);
      setStep(3);
      // Navigate to payment screen with order details
      navigation.navigate('PaymentConfirmation', { order });
    } catch (err) {
      Alert.alert('Error', 'Failed to create channel order');
    } finally {
      setIsLoading(false);
    }
  };

  const renderStepIndicator = () => (
    <View style={styles.stepIndicator}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={styles.stepItem}>
          <View style={[
            styles.stepCircle,
            step === i ? styles.activeStep : step > i ? styles.completedStep : styles.inactiveStep
          ]}>
            <Text style={styles.stepNumber}>{i}</Text>
          </View>
          <Text style={styles.stepLabel}>
            {i === 1 ? 'Connect' : i === 2 ? 'Configure' : 'Payment'}
          </Text>
        </View>
      ))}
    </View>
  );

  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Card style={styles.connectionCard}>
        <Text style={styles.cardTitle}>LSP Connection</Text>
        <TextInput
          style={styles.input}
          value={connectionUrl}
          onChangeText={setConnectionUrl}
          placeholder="Enter LSP connection URL"
          placeholderTextColor={theme.colors.gray[400]}
        />
        <Button
          title={isConnected ? "Continue" : "Connect to LSP"}
          onPress={isConnected ? () => setStep(2) : handleConnect}
          variant="primary"
          loading={isLoading}
          style={styles.button}
        />
      </Card>
    </View>
  );

  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Card style={styles.configCard}>
        <Text style={styles.cardTitle}>Channel Configuration</Text>
        <TextInput
          style={styles.input}
          value={formData.capacitySat}
          onChangeText={(value) => setFormData({ ...formData, capacitySat: value })}
          placeholder="Channel Capacity (sats)"
          keyboardType="numeric"
          placeholderTextColor={theme.colors.gray[400]}
        />
        <TextInput
          style={styles.input}
          value={formData.clientBalanceSat}
          onChangeText={(value) => setFormData({ ...formData, clientBalanceSat: value })}
          placeholder="Local Balance (sats)"
          keyboardType="numeric"
          placeholderTextColor={theme.colors.gray[400]}
        />
        <Button
          title="Create Order"
          onPress={handleCreateOrder}
          variant="primary"
          loading={isLoading}
          style={styles.button}
        />
      </Card>
    </View>
  );

  const renderStep3 = () => (
    <View style={styles.stepContainer}>
      <Card style={styles.paymentCard}>
        <Text style={styles.cardTitle}>Payment</Text>
        <ActivityIndicator size="large" color={theme.colors.primary[500]} />
        <Text style={styles.loadingText}>Redirecting to payment...</Text>
      </Card>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Buy Channel</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        {renderStepIndicator()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  title: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  content: {
    flex: 1,
  },
  stepIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  stepItem: {
    alignItems: 'center',
  },
  stepCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
  },
  activeStep: {
    backgroundColor: theme.colors.primary[500],
  },
  completedStep: {
    backgroundColor: theme.colors.success[500],
  },
  inactiveStep: {
    backgroundColor: theme.colors.gray[600],
  },
  stepNumber: {
    color: theme.colors.text.inverse,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
  },
  stepLabel: {
    color: theme.colors.text.secondary,
    fontSize: theme.typography.fontSize.xs,
  },
  stepContainer: {
    padding: theme.spacing[4],
  },
  connectionCard: {
    padding: theme.spacing[4],
  },
  configCard: {
    padding: theme.spacing[4],
  },
  paymentCard: {
    padding: theme.spacing[4],
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[4],
  },
  input: {
    backgroundColor: theme.colors.surface.secondary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
  },
  button: {
    marginTop: theme.spacing[4],
  },
  loadingText: {
    marginTop: theme.spacing[4],
    color: theme.colors.text.primary,
    fontSize: theme.typography.fontSize.base,
  },
}); 