// screens/PaymentConfirmationScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
  Animated,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';
import { Card, Button } from '../components';
import { useAssetIcon } from '../utils';
import LottieView from 'lottie-react-native';

interface PaymentData {
  type: 'bitcoin' | 'bip21' | 'lightning' | 'rgb';
  address?: string;
  amount?: string;
  label?: string;
  message?: string;
  invoice?: string;
  decodedInvoice?: any;
  decodedRGBInvoice?: any;
  selectedAsset?: {
    asset_id: string;
    ticker: string;
    name: string;
    isRGB: boolean;
  };
}

interface Props {
  navigation: any;
  route: {
    params: {
      paymentData: PaymentData;
    };
  };
}

export default function PaymentConfirmationScreen({ navigation, route }: Props) {
  const { paymentData } = route.params;
  const [loading, setLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState(paymentData.amount || '');
  const [showAmountInput, setShowAmountInput] = useState(!paymentData.amount);
  const [amountError, setAmountError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  const modalAnim = useRef(new Animated.Value(0)).current;
  const successAnim = useRef<LottieView>(null);
  const errorAnim = useRef<LottieView>(null);

  useEffect(() => {
    if (showConfirmModal) {
      Animated.spring(modalAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }).start();
    } else {
      Animated.timing(modalAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [showConfirmModal]);

  const handleAmountChange = (text: string) => {
    // Remove any non-numeric characters except decimal point
    const cleanedText = text.replace(/[^0-9.]/g, '');
    
    // Ensure only one decimal point
    const parts = cleanedText.split('.');
    if (parts.length > 2) return;
    
    // Limit decimal places based on asset
    const maxDecimals = paymentData.selectedAsset?.ticker === 'BTC' ? 8 : 2;
    if (parts[1] && parts[1].length > maxDecimals) return;
    
    setCustomAmount(cleanedText);
    setAmountError('');
  };

  const validateAmount = () => {
    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) {
      setAmountError('Please enter a valid amount');
      return false;
    }
    return true;
  };

  const handleConfirm = () => {
    if (showAmountInput && !validateAmount()) {
      return;
    }
    setShowConfirmModal(true);
  };

  const handleFinalConfirm = () => {
    setLoading(true);
    
    // Show success animation
    successAnim.current?.play();
    
    // Navigate to Send screen with all the payment data
    setTimeout(() => {
      setShowConfirmModal(false);
      navigation.navigate('Send', {
        selectedAsset: paymentData.selectedAsset,
        prefilledAddress: paymentData.address || paymentData.invoice,
        prefilledAmount: showAmountInput ? customAmount : paymentData.amount,
        label: paymentData.label,
        message: paymentData.message,
        decodedInvoice: paymentData.decodedInvoice,
        decodedRGBInvoice: paymentData.decodedRGBInvoice,
        isLightning: paymentData.type === 'lightning',
      });
    }, 1500);
  };

  const handleCancel = () => {
    if (showConfirmModal) {
      setShowConfirmModal(false);
    } else {
      navigation.goBack();
    }
  };

  const AssetIcon = ({ asset }: { asset?: any }) => {
    const { iconUrl } = useAssetIcon(asset?.ticker || '');
    
    if (!asset) return null;
    
    if (asset.ticker === 'BTC') {
      return (
        <View style={styles.assetIconContainer}>
          <Ionicons name="logo-bitcoin" size={32} color="#F7931A" />
        </View>
      );
    }
    
    if (iconUrl) {
      return (
        <View style={styles.assetIconContainer}>
          <Image source={{ uri: iconUrl }} style={styles.assetIconImage} />
        </View>
      );
    }
    
    return (
      <View style={styles.assetIconContainer}>
        <Ionicons name="diamond" size={32} color={theme.colors.primary[500]} />
      </View>
    );
  };

  const getPaymentTypeInfo = () => {
    switch (paymentData.type) {
      case 'bitcoin':
        return {
          title: 'Bitcoin Payment',
          subtitle: 'On-chain transaction',
          icon: 'link',
          color: '#F7931A',
        };
      case 'bip21':
        return {
          title: 'Bitcoin Payment Request',
          subtitle: 'BIP21 payment request',
          icon: 'qr-code',
          color: '#F7931A',
        };
      case 'lightning':
        return {
          title: 'Lightning Payment',
          subtitle: 'Instant Lightning Network payment',
          icon: 'flash',
          color: '#FFD700',
        };
      case 'rgb':
        return {
          title: 'RGB Asset Payment',
          subtitle: 'RGB protocol asset transfer',
          icon: 'diamond',
          color: theme.colors.primary[500],
        };
      default:
        return {
          title: 'Payment',
          subtitle: 'Payment request',
          icon: 'cash',
          color: theme.colors.primary[500],
        };
    }
  };

  const typeInfo = getPaymentTypeInfo();

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <LinearGradient
        colors={['#4338ca', '#7c3aed'] as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={handleCancel}
          >
            <Ionicons name="arrow-back" size={24} color={theme.colors.text.inverse} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Confirm Payment</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.paymentTypeContainer}>
          <View style={[styles.paymentTypeIcon, { backgroundColor: typeInfo.color + '20' }]}>
            <Ionicons name={typeInfo.icon as any} size={32} color={typeInfo.color} />
          </View>
          <Text style={styles.paymentTypeTitle}>{typeInfo.title}</Text>
          <Text style={styles.paymentTypeSubtitle}>{typeInfo.subtitle}</Text>
        </View>
      </LinearGradient>
    </View>
  );

  const renderPaymentDetails = () => (
    <Card style={styles.detailsCard}>
      <Text style={styles.sectionTitle}>Payment Details</Text>
      
      {/* Asset Information */}
      {paymentData.selectedAsset && (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Asset</Text>
          <View style={styles.assetDetailContainer}>
            <AssetIcon asset={paymentData.selectedAsset} />
            <View style={styles.assetDetailText}>
              <Text style={styles.assetDetailTicker}>{paymentData.selectedAsset.ticker}</Text>
              <Text style={styles.assetDetailName}>{paymentData.selectedAsset.name}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Amount */}
      {paymentData.amount && (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Amount</Text>
          <View style={styles.amountContainer}>
            <Text style={styles.amountValue}>
              {paymentData.amount} {paymentData.selectedAsset?.ticker}
            </Text>
            {paymentData.selectedAsset?.ticker === 'BTC' && (
              <Text style={styles.amountFiat}>
                ≈ ${((parseFloat(paymentData.amount) || 0) * 50000).toLocaleString()} USD
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Recipient */}
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>
          {paymentData.type === 'lightning' || paymentData.type === 'rgb' ? 'Invoice' : 'Address'}
        </Text>
        <Text style={styles.addressText} numberOfLines={3}>
          {paymentData.address || paymentData.invoice}
        </Text>
      </View>

      {/* Label */}
      {paymentData.label && (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Label</Text>
          <Text style={styles.detailValue}>{paymentData.label}</Text>
        </View>
      )}

      {/* Message */}
      {paymentData.message && (
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Message</Text>
          <Text style={styles.detailValue}>{paymentData.message}</Text>
        </View>
      )}

      {/* Lightning Invoice Details */}
      {paymentData.decodedInvoice && (
        <>
          {paymentData.decodedInvoice.description && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Description</Text>
              <Text style={styles.detailValue}>{paymentData.decodedInvoice.description}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Payee</Text>
            <Text style={styles.addressText} numberOfLines={2}>
              {paymentData.decodedInvoice.payee_pubkey}
            </Text>
          </View>
        </>
      )}

      {/* RGB Invoice Details */}
      {paymentData.decodedRGBInvoice && (
        <>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Recipient ID</Text>
            <Text style={styles.addressText} numberOfLines={2}>
              {paymentData.decodedRGBInvoice.recipient_id}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Expires</Text>
            <Text style={styles.detailValue}>
              {new Date(paymentData.decodedRGBInvoice.expiration_timestamp).toLocaleString()}
            </Text>
          </View>
        </>
      )}
    </Card>
  );

  const renderActions = () => (
    <View style={styles.actionsContainer}>
      <Button
        title="Cancel"
        variant="outline"
        onPress={handleCancel}
        style={styles.cancelButton}
      />
      <Button
        title={paymentData.amount ? "Confirm Payment" : "Enter Amount"}
        variant="primary"
        onPress={handleConfirm}
        loading={loading}
        style={styles.confirmButton}
      />
    </View>
  );

  const renderAmountInput = () => {
    if (!showAmountInput) return null;

    return (
      <Card style={styles.amountInputCard}>
        <Text style={styles.amountInputLabel}>Enter Amount</Text>
        <View style={styles.amountInputContainer}>
          <TextInput
            style={styles.amountInput}
            value={customAmount}
            onChangeText={handleAmountChange}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={theme.colors.text.muted}
            autoFocus
          />
          <Text style={styles.amountInputCurrency}>
            {paymentData.selectedAsset?.ticker}
          </Text>
        </View>
        {amountError ? (
          <Text style={styles.amountError}>{amountError}</Text>
        ) : null}
        {paymentData.selectedAsset?.ticker === 'BTC' && customAmount ? (
          <Text style={styles.amountFiat}>
            ≈ ${((parseFloat(customAmount) || 0) * 50000).toLocaleString()} USD
          </Text>
        ) : null}
      </Card>
    );
  };

  const renderConfirmationModal = () => (
    <Modal
      visible={showConfirmModal}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[
            styles.modalContent,
            {
              transform: [
                {
                  translateY: modalAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [300, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalIcon}>
              <Ionicons name="shield-checkmark" size={32} color={theme.colors.primary[500]} />
            </View>
            <Text style={styles.modalTitle}>Confirm Payment</Text>
            <Text style={styles.modalSubtitle}>
              Please review the payment details
            </Text>
          </View>

          <View style={styles.modalDetails}>
            <View style={styles.modalDetailRow}>
              <Text style={styles.modalDetailLabel}>Amount</Text>
              <Text style={styles.modalDetailValue}>
                {showAmountInput ? customAmount : paymentData.amount}{' '}
                {paymentData.selectedAsset?.ticker}
              </Text>
            </View>
            <View style={styles.modalDetailRow}>
              <Text style={styles.modalDetailLabel}>To</Text>
              <Text style={styles.modalDetailValue} numberOfLines={1}>
                {paymentData.address || paymentData.invoice?.substring(0, 20) + '...'}
              </Text>
            </View>
          </View>

          <View style={styles.modalActions}>
            <Button
              title="Cancel"
              variant="outline"
              onPress={handleCancel}
              style={styles.modalButton}
            />
            <Button
              title="Confirm"
              variant="primary"
              onPress={handleFinalConfirm}
              loading={loading}
              style={[styles.modalButton, styles.modalConfirmButton]}
            />
          </View>

          <LottieView
            ref={successAnim}
            source={require('../assets/animations/success.json')}
            style={styles.modalAnimation}
            autoPlay={false}
            loop={false}
          />
        </Animated.View>
      </View>
    </Modal>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.container}>
        {renderHeader()}
        
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {renderAmountInput()}
          {renderPaymentDetails()}
          
          <View style={styles.bottomPadding} />
        </ScrollView>

        {renderActions()}
        {renderConfirmationModal()}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  
  headerContainer: {
    marginBottom: theme.spacing[4],
  },
  
  headerGradient: {
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[8],
    borderBottomLeftRadius: theme.borderRadius['2xl'],
    borderBottomRightRadius: theme.borderRadius['2xl'],
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
    marginBottom: theme.spacing[6],
  },
  
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.base,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  headerTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.inverse,
  },
  
  placeholder: {
    width: 40,
  },
  
  paymentTypeContainer: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing[5],
  },
  
  paymentTypeIcon: {
    width: 64,
    height: 64,
    borderRadius: theme.borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },
  
  paymentTypeTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.inverse,
    marginBottom: theme.spacing[1],
    textAlign: 'center',
  },
  
  paymentTypeSubtitle: {
    fontSize: theme.typography.fontSize.base,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  
  scrollView: {
    flex: 1,
  },
  
  scrollContent: {
    paddingHorizontal: theme.spacing[5],
  },
  
  detailsCard: {
    padding: theme.spacing[5],
    marginBottom: theme.spacing[4],
  },
  
  sectionTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[4],
  },
  
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[100],
  },
  
  detailLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    flex: 1,
    marginRight: theme.spacing[3],
  },
  
  detailValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    flex: 2,
    textAlign: 'right',
  },
  
  addressText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.primary,
    fontFamily: 'monospace',
    flex: 2,
    textAlign: 'right',
    lineHeight: 16,
  },
  
  assetDetailContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 2,
    justifyContent: 'flex-end',
  },
  
  assetIconContainer: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[2],
  },
  
  assetIconImage: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  
  assetDetailText: {
    alignItems: 'flex-end',
  },
  
  assetDetailTicker: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  
  assetDetailName: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
  },
  
  amountContainer: {
    alignItems: 'flex-end',
    flex: 2,
  },
  
  amountValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  
  amountFiat: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[1],
  },
  
  actionsContainer: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[4],
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    gap: theme.spacing[3],
  },
  
  cancelButton: {
    flex: 1,
  },
  
  confirmButton: {
    flex: 2,
  },
  
  bottomPadding: {
    height: theme.spacing[4],
  },

  amountInputCard: {
    padding: theme.spacing[5],
    marginBottom: theme.spacing[4],
  },

  amountInputLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[2],
  },

  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    height: 56,
  },

  amountInput: {
    flex: 1,
    fontSize: theme.typography.fontSize.xl,
    color: theme.colors.text.primary,
    fontWeight: '600',
  },

  amountInputCurrency: {
    fontSize: theme.typography.fontSize.lg,
    color: theme.colors.text.secondary,
    marginLeft: theme.spacing[2],
  },

  amountError: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[500],
    marginTop: theme.spacing[2],
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },

  modalContent: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    padding: theme.spacing[5],
  },

  modalHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[5],
  },

  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[3],
  },

  modalTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },

  modalSubtitle: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },

  modalDetails: {
    marginBottom: theme.spacing[5],
  },

  modalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },

  modalDetailLabel: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },

  modalDetailValue: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    flex: 1,
    textAlign: 'right',
  },

  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing[3],
  },

  modalButton: {
    flex: 1,
  },

  modalConfirmButton: {
    flex: 2,
  },

  modalAnimation: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
  },
}); 