// components/CreateUTXOModal.tsx
import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import RGBApiService from '../services/RGBApiService';
import { initializeRGBApiService } from '../services/initializeServices';

interface CreateUTXOModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  operationType: 'issuance' | 'channel';
  channelCapacity?: number;
  error?: string;
}

const DEFAULT_UTXO_SIZE = 3000;

export const CreateUTXOModal: React.FC<CreateUTXOModalProps> = ({
  visible,
  onClose,
  onSuccess,
  operationType,
  channelCapacity = 0,
  error,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [feeRate, setFeeRate] = useState(1.0);
  const [numUtxos, setNumUtxos] = useState(() => {
    // For channel creation with no uncolored UTXOs, always use 1 UTXO
    if (
      operationType === 'channel' &&
      (error?.includes('No uncolored UTXOs') ||
        error?.includes('No uncolored UTXOs available'))
    ) {
      return 1;
    }
    return 3;
  });
  const [utxoSize, setUtxoSize] = useState(() => {
    // For channel creation with no uncolored UTXOs, use the channel capacity
    if (
      operationType === 'channel' &&
      (error?.includes('No uncolored UTXOs') ||
        error?.includes('No uncolored UTXOs available'))
    ) {
      return channelCapacity || DEFAULT_UTXO_SIZE;
    }
    // Default size for issuing an asset
    if (operationType === 'issuance') {
      return DEFAULT_UTXO_SIZE;
    }
    // For channel, use the channel capacity
    return channelCapacity || DEFAULT_UTXO_SIZE;
  });

  useEffect(() => {
    if (visible) {
      // Use a reasonable default fee rate
      setFeeRate(1.0);
    }
  }, [visible]);

  // Update UTXO size when channelCapacity changes
  useEffect(() => {
    if (
      channelCapacity &&
      channelCapacity > 0 &&
      operationType === 'channel' &&
      (error?.includes('No uncolored UTXOs') ||
        error?.includes('No uncolored UTXOs available'))
    ) {
      setUtxoSize(channelCapacity);
    }
  }, [channelCapacity, operationType, error]);

  const handleCreateUTXOs = async () => {
    setIsLoading(true);

    try {
      const apiService = initializeRGBApiService();
      if (!apiService) {
        throw new Error('API service not available');
      }

      await apiService.createUtxos({
        fee_rate: feeRate,
        num: numUtxos,
        size: utxoSize,
        skip_sync: false,
      });

      Alert.alert('Success', 'UTXOs created successfully');
      onClose();
      onSuccess();
    } catch (error: any) {
      console.error('Failed to create UTXOs:', error);
      Alert.alert('Error', error?.message || 'Failed to create UTXOs');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={theme.colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Colored UTXOs</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Error Display */}
          {error && (
            <View style={styles.errorCard}>
              <View style={styles.errorIconContainer}>
                <Ionicons name="warning" size={20} color={theme.colors.error[500]} />
              </View>
              <Text style={styles.errorText}>Error: {error}</Text>
            </View>
          )}

          {/* Info Card */}
          <View style={styles.infoCard}>
            <View style={styles.infoIconContainer}>
              <Ionicons name="flash" size={20} color={theme.colors.primary[500]} />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoTitle}>
                {operationType === 'issuance'
                  ? 'Issuing an RGB asset requires colorable UTXOs.'
                  : 'Opening a channel with RGB assets requires colorable UTXOs.'}
              </Text>
              <Text style={styles.infoDescription}>
                This operation requires an on-chain transaction. A fee of approximately{' '}
                <Text style={styles.feeText}>{feeRate.toFixed(2)} sat/vB</Text> will be used.
              </Text>
            </View>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Number of UTXOs</Text>
              <View style={styles.stepperContainer}>
                <TouchableOpacity
                  style={[styles.stepperButton, numUtxos <= 1 && styles.stepperButtonDisabled]}
                  disabled={numUtxos <= 1}
                  onPress={() => setNumUtxos(Math.max(1, numUtxos - 1))}
                >
                  <Ionicons name="remove" size={20} color={numUtxos <= 1 ? theme.colors.gray[400] : theme.colors.text.primary} />
                </TouchableOpacity>
                
                <TextInput
                  style={styles.stepperInput}
                  value={String(numUtxos)}
                  onChangeText={(text) => setNumUtxos(Math.max(1, parseInt(text) || 1))}
                  keyboardType="numeric"
                  textAlign="center"
                />
                
                <TouchableOpacity
                  style={[styles.stepperButton, numUtxos >= 10 && styles.stepperButtonDisabled]}
                  disabled={numUtxos >= 10}
                  onPress={() => setNumUtxos(Math.min(10, numUtxos + 1))}
                >
                  <Ionicons name="add" size={20} color={numUtxos >= 10 ? theme.colors.gray[400] : theme.colors.text.primary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.hint}>Recommended: 1-10 UTXOs</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>UTXO Size (in satoshis)</Text>
              <TextInput
                style={styles.input}
                value={String(utxoSize)}
                onChangeText={(text) => setUtxoSize(Math.max(5000, parseInt(text) || 5000))}
                keyboardType="numeric"
                placeholder="3000"
                placeholderTextColor={theme.colors.text.muted}
              />
              <Text style={styles.hint}>Minimum: 5,000 sats</Text>
            </View>

            {/* Summary */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Transaction Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total amount:</Text>
                <Text style={styles.summaryValue}>
                  {(numUtxos * utxoSize).toLocaleString()} sats
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Fee rate:</Text>
                <Text style={styles.summaryValue}>{feeRate.toFixed(2)} sat/vB</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            disabled={isLoading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.createButton, isLoading && styles.createButtonDisabled]}
            onPress={handleCreateUTXOs}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <ActivityIndicator size="small" color={theme.colors.text.inverse} />
                <Text style={[styles.createButtonText, { marginLeft: theme.spacing[2] }]}>
                  Creating...
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="flash" size={18} color={theme.colors.text.inverse} />
                <Text style={[styles.createButtonText, { marginLeft: theme.spacing[2] }]}>
                  Create UTXOs
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
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
  
  errorCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.error[50],
    borderColor: theme.colors.error[200],
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginTop: theme.spacing[4],
    marginBottom: theme.spacing[3],
  },
  
  errorIconContainer: {
    marginRight: theme.spacing[3],
    marginTop: 2,
  },
  
  errorText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[700],
    fontWeight: '500',
  },
  
  infoCard: {
    flexDirection: 'row',
    backgroundColor: theme.colors.primary[50],
    borderColor: theme.colors.primary[200],
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
  
  infoTextContainer: {
    flex: 1,
  },
  
  infoTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[700],
    marginBottom: theme.spacing[2],
  },
  
  infoDescription: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.primary[600],
    lineHeight: 20,
  },
  
  feeText: {
    fontWeight: '700',
    color: theme.colors.primary[800],
  },
  
  form: {
    gap: theme.spacing[5],
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
  
  stepperContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
  
  stepperButton: {
    width: 44,
    height: 44,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  stepperButtonDisabled: {
    backgroundColor: theme.colors.gray[50],
  },
  
  stepperInput: {
    flex: 1,
    backgroundColor: theme.colors.surface.primary,
    paddingHorizontal: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    textAlign: 'center',
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
  
  hint: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.muted,
    marginTop: theme.spacing[1],
  },
  
  summaryCard: {
    backgroundColor: theme.colors.gray[50],
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
  },
  
  summaryTitle: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[3],
  },
  
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
  },
  
  summaryLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  
  summaryValue: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
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
  
  createButton: {
    flex: 2,
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    ...theme.shadows.sm,
  },
  
  createButtonDisabled: {
    backgroundColor: theme.colors.gray[300],
  },
  
  createButtonText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.inverse,
  },
}); 