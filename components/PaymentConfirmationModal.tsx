// components/PaymentConfirmationModal.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  Image,
  Vibration,
  ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface PaymentDetails {
  type: 'lightning_address' | 'lightning_invoice' | 'nostr_contact';
  recipient: string;
  amount: number;
  description?: string;
  recipientName?: string;
  recipientAvatar?: string;
  lightningAddress?: string;
  isNostrContact?: boolean;
}

interface Props {
  visible: boolean;
  paymentDetails: PaymentDetails | null;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function PaymentConfirmationModal({
  visible,
  paymentDetails,
  onConfirm,
  onCancel,
  loading = false,
}: Props) {
  const [slideAnim] = useState(new Animated.Value(screenHeight));
  const [fadeAnim] = useState(new Animated.Value(0));
  const [scaleAnim] = useState(new Animated.Value(0.9));

  useEffect(() => {
    if (visible) {
      Vibration.vibrate(50);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 65,
          friction: 11,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: screenHeight,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const handleConfirm = () => {
    Vibration.vibrate(100);
    onConfirm();
  };

  const formatAmount = (amount: number): string => {
    if (amount >= 1000000) {
      return `${(amount / 1000000).toFixed(2)}M`;
    } else if (amount >= 1000) {
      return `${(amount / 1000).toFixed(1)}K`;
    }
    return amount.toLocaleString();
  };

  const getRecipientIcon = () => {
    if (paymentDetails?.isNostrContact) {
      return 'people';
    }
    if (paymentDetails?.type === 'lightning_address') {
      return 'at';
    }
    return 'flash';
  };

  const getPaymentTypeLabel = () => {
    switch (paymentDetails?.type) {
      case 'lightning_address':
        return 'Lightning Address';
      case 'lightning_invoice':
        return 'Lightning Invoice';
      case 'nostr_contact':
        return 'Nostr Contact';
      default:
        return 'Lightning Payment';
    }
  };

  if (!paymentDetails) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
    >
      <Animated.View
        style={[
          styles.overlay,
          {
            opacity: fadeAnim,
          },
        ]}
      >
        <BlurView intensity={20} style={StyleSheet.absoluteFill} />
        
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onCancel}
        />

        <Animated.View
          style={[
            styles.modalContainer,
            {
              transform: [
                { translateY: slideAnim },
                { scale: scaleAnim },
              ],
            },
          ]}
        >
          <View style={styles.modal}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.handleBar} />
              <View style={styles.headerContent}>
                <View style={styles.iconContainer}>
                  <LinearGradient
                    colors={theme.colors.warning.gradient!}
                    style={styles.iconGradient}
                  >
                    <Ionicons name="shield-checkmark" size={24} color="white" />
                  </LinearGradient>
                </View>
                <Text style={styles.title}>Confirm Payment</Text>
                <Text style={styles.subtitle}>
                  Please review the payment details before proceeding
                </Text>
              </View>
            </View>

            {/* Payment Details */}
            <View style={styles.paymentCard}>
              <LinearGradient
                colors={['#667eea', '#764ba2']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.amountGradient}
              >
                <Text style={styles.amountLabel}>Payment Amount</Text>
                <Text style={styles.amount}>
                  {formatAmount(paymentDetails.amount)} sats
                </Text>
                <Text style={styles.amountUsd}>
                  ≈ ${((paymentDetails.amount / 100000000) * 45000).toFixed(2)} USD
                </Text>
              </LinearGradient>

              {/* Recipient Info */}
              <View style={styles.recipientSection}>
                <View style={styles.recipientHeader}>
                  <View style={styles.recipientIconContainer}>
                    {paymentDetails.recipientAvatar ? (
                      <Image
                        source={{ uri: paymentDetails.recipientAvatar }}
                        style={styles.avatar}
                      />
                    ) : (
                      <View style={[styles.avatarPlaceholder, { backgroundColor: theme.colors.primary[100] }]}>
                        <Ionicons name={getRecipientIcon()} size={20} color={theme.colors.primary[600]} />
                      </View>
                    )}
                    <View style={styles.recipientInfo}>
                      <Text style={styles.recipientName}>
                        {paymentDetails.recipientName || 'Lightning Payment'}
                      </Text>
                      <Text style={styles.recipientType}>
                        {getPaymentTypeLabel()}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.recipientDetails}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>To:</Text>
                    <Text style={styles.detailValue} numberOfLines={1}>
                      {paymentDetails.recipient}
                    </Text>
                  </View>
                  
                  {paymentDetails.lightningAddress && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Lightning Address:</Text>
                      <Text style={styles.detailValue} numberOfLines={1}>
                        {paymentDetails.lightningAddress}
                      </Text>
                    </View>
                  )}

                  {paymentDetails.description && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Description:</Text>
                      <Text style={styles.detailValue}>
                        {paymentDetails.description}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* Security Notice */}
            <View style={styles.securityNotice}>
              <Ionicons name="information-circle" size={16} color={theme.colors.primary[500]} />
              <Text style={styles.securityText}>
                This payment cannot be reversed. Please verify all details carefully.
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={onCancel}
                disabled={loading}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, loading && styles.buttonDisabled]}
                onPress={handleConfirm}
                disabled={loading}
              >
                <LinearGradient
                  colors={loading ? ['#9CA3AF', '#9CA3AF'] : ['#667eea', '#764ba2']}
                  style={styles.confirmGradient}
                >
                  {loading ? (
                    <View style={styles.loadingContent}>
                      <ActivityIndicator
                        size="small"
                        color="white"
                        style={styles.loadingSpinner}
                      />
                      <Text style={styles.confirmText}>Processing...</Text>
                    </View>
                  ) : (
                    <>
                      <Ionicons name="send" size={18} color="white" />
                      <Text style={styles.confirmText}>Confirm Payment</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  modalContainer: {
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius.xl,
    borderTopRightRadius: theme.borderRadius.xl,
    paddingBottom: 40,
    maxHeight: screenHeight * 0.8,
  },
  header: {
    paddingTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
    paddingBottom: theme.spacing[6],
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.gray[300],
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: theme.spacing[4],
  },
  headerContent: {
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: theme.spacing[3],
  },
  iconGradient: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  subtitle: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  paymentCard: {
    marginHorizontal: theme.spacing[6],
    marginBottom: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    ...theme.shadows.md,
  },
  amountGradient: {
    padding: theme.spacing[6],
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: theme.spacing[1],
  },
  amount: {
    fontSize: theme.typography.fontSize['4xl'],
    fontWeight: theme.typography.fontWeight.bold,
    color: 'white',
    marginBottom: theme.spacing[1],
  },
  amountUsd: {
    fontSize: theme.typography.fontSize.base,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  recipientSection: {
    backgroundColor: theme.colors.surface.primary,
    padding: theme.spacing[5],
  },
  recipientHeader: {
    marginBottom: theme.spacing[4],
  },
  recipientIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: theme.spacing[3],
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing[3],
  },
  recipientInfo: {
    flex: 1,
  },
  recipientName: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[1],
  },
  recipientType: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
  },
  recipientDetails: {
    gap: theme.spacing[3],
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  detailLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.text.secondary,
    flex: 1,
  },
  detailValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    flex: 2,
    textAlign: 'right',
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing[6],
    marginBottom: theme.spacing[6],
    padding: theme.spacing[3],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary[100],
  },
  securityText: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.primary[600],
    marginLeft: theme.spacing[2],
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[3],
  },
  cancelButton: {
    flex: 1,
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.gray[100],
    alignItems: 'center',
  },
  cancelText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.text.secondary,
  },
  confirmButton: {
    flex: 2,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  confirmGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
    gap: theme.spacing[2],
  },
  confirmText: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: theme.typography.fontWeight.semibold,
    color: 'white',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
  },
  loadingSpinner: {
    width: 20,
    height: 20,
  },
}); 