// components/IssueAssetModal.tsx
import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../store';
import { issueNiaAsset } from '../store/slices/assetsSlice';
import { theme } from '../theme';
import { CreateUTXOModal } from './CreateUTXOModal';

interface IssueAssetModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const IssueAssetModal: React.FC<IssueAssetModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const { activeWallet } = useSelector((state: RootState) => state.wallet);
  
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [precision, setPrecision] = useState('0');
  const [isLoading, setIsLoading] = useState(false);
  const [showUTXOModal, setShowUTXOModal] = useState(false);
  const [utxoError, setUtxoError] = useState<string>('');

  // Calculate the actual amount that will be issued with decimal places
  const actualAmount = useMemo(() => {
    if (
      !amount ||
      isNaN(Number(amount)) ||
      !precision ||
      isNaN(Number(precision))
    ) {
      return '0';
    }

    // Convert to base units (add zeros based on precision)
    const baseAmount = Number(amount) * Math.pow(10, Number(precision));
    return baseAmount.toString();
  }, [amount, precision]);

  // Format preview amount with decimal places
  const previewAmount = useMemo(() => {
    if (!amount || isNaN(Number(amount))) {
      return '0';
    }

    // Clamp precision between 0 and 10
    let safePrecision = Number(precision);
    if (isNaN(safePrecision) || safePrecision < 0) safePrecision = 0;
    if (safePrecision > 10) safePrecision = 10;

    // Display with appropriate decimal places
    return Number(amount).toFixed(safePrecision);
  }, [amount, precision]);

  const resetForm = () => {
    setTicker('');
    setName('');
    setAmount('');
    setPrecision('0');
  };

  const handleIssueAsset = async () => {
    if (!ticker || !name || !amount) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    if (Number(amount) <= 0) {
      Alert.alert('Error', 'Amount must be greater than 0');
      return;
    }

    if (!activeWallet) {
      Alert.alert('Error', 'No active wallet found');
      return;
    }

    setIsLoading(true);

    try {
      await dispatch(issueNiaAsset({
        amounts: [Number(actualAmount)],
        name,
        precision: Number(precision),
        ticker: ticker.toUpperCase(),
        walletId: activeWallet.id,
      })).unwrap();

      Alert.alert('Success', 'Asset issued successfully!');
      resetForm();
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Failed to issue asset:', error);
      
      // Check if it's a UTXO-related error
      const errorMessage = error?.message || String(error);
      if (errorMessage.includes('No uncolored UTXOs') || 
          errorMessage.includes('createutxos') ||
          errorMessage.includes('InsufficientAllocationSlots')) {
        setUtxoError(errorMessage);
        setShowUTXOModal(true);
      } else {
        Alert.alert('Error', errorMessage || 'Failed to issue asset');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const retryIssueAsset = async () => {
    // Retry the asset issuance after UTXOs are created
    setShowUTXOModal(false);
    await handleIssueAsset();
  };

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={handleClose}
      >
        <SafeAreaView style={styles.container}>
          <KeyboardAvoidingView 
            style={styles.keyboardAvoid}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={theme.colors.text.primary} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Issue New Asset</Text>
              <View style={styles.placeholder} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
              {/* Info Card */}
              <View style={styles.infoCard}>
                <View style={styles.infoIconContainer}>
                  <Ionicons name="information-circle" size={20} color={theme.colors.primary[500]} />
                </View>
                <Text style={styles.infoText}>
                  Issuing a new asset requires colored UTXOs. The process may involve an on-chain transaction if you don't have enough colored UTXOs.
                </Text>
              </View>

              {/* Form Fields */}
              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Ticker Symbol *</Text>
                  <TextInput
                    style={styles.input}
                    value={ticker}
                    onChangeText={(text) => setTicker(text.toUpperCase())}
                    placeholder="BTC"
                    maxLength={5}
                    autoCapitalize="characters"
                    placeholderTextColor={theme.colors.text.muted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Asset Name *</Text>
                  <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Bitcoin"
                    placeholderTextColor={theme.colors.text.muted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Amount to Issue *</Text>
                  <TextInput
                    style={styles.input}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder="100"
                    keyboardType="numeric"
                    placeholderTextColor={theme.colors.text.muted}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Precision (decimal places)</Text>
                  <TextInput
                    style={styles.input}
                    value={precision}
                    onChangeText={(text) => {
                      // Remove fraction inputs
                      const floored = Math.floor(Number(text) || 0);
                      setPrecision(String(floored));
                    }}
                    placeholder="8"
                    keyboardType="numeric"
                    placeholderTextColor={theme.colors.text.muted}
                  />
                  {(Number(precision) > 10 || Number(precision) < 0) && precision !== '' && (
                    <Text style={styles.errorText}>
                      Precision value must be between 0 and 10.
                    </Text>
                  )}
                </View>

                {amount && (
                  <View style={styles.previewCard}>
                    <Text style={styles.previewLabel}>You will issue:</Text>
                    <Text style={styles.previewAmount}>{previewAmount} {ticker || 'TOKEN'}</Text>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleClose}
                disabled={isLoading}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.issueButton,
                  (isLoading || !ticker || !name || !amount) && styles.issueButtonDisabled
                ]}
                onPress={handleIssueAsset}
                disabled={isLoading || !ticker || !name || !amount}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.text.inverse} />
                ) : (
                  <Text style={styles.issueButtonText}>Issue Asset</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* UTXO Modal */}
      <CreateUTXOModal
        visible={showUTXOModal}
        onClose={() => setShowUTXOModal(false)}
        onSuccess={retryIssueAsset}
        operationType="issuance"
        error={utxoError}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  
  keyboardAvoid: {
    flex: 1,
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.base,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  placeholder: {
    width: 32,
  },
  
  content: {
    flex: 1,
    paddingHorizontal: theme.spacing[5],
  },
  
  infoCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.primary[50],
    borderColor: theme.colors.primary[100],
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[5],
  },
  
  infoIconContainer: {
    marginRight: theme.spacing[3],
    marginTop: 2,
  },
  
  infoText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[700],
    lineHeight: 20,
  },
  
  form: {
    gap: theme.spacing[4],
  },
  
  inputGroup: {
    marginBottom: theme.spacing[1],
  },
  
  label: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  
  input: {
    backgroundColor: theme.colors.surface.primary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  
  errorText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.error[500],
    marginTop: theme.spacing[1],
  },
  
  previewCard: {
    backgroundColor: theme.colors.success[50],
    borderColor: theme.colors.success[500],
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    alignItems: 'center',
    marginTop: theme.spacing[2],
  },
  
  previewLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.success[600],
    marginBottom: theme.spacing[1],
  },
  
  previewAmount: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.success[600],
  },
  
  footer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    gap: theme.spacing[3],
  },
  
  cancelButton: {
    flex: 1,
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  cancelButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  issueButton: {
    flex: 2,
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.sm,
  },
  
  issueButtonDisabled: {
    backgroundColor: theme.colors.gray[300],
    ...{},
  },
  
  issueButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
}); 