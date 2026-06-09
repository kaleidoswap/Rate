// components/InvoiceQRCode.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Clipboard,
  Platform,
  Animated,
  Dimensions,
  Pressable,
  Share,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

/**
 * Open the OS share sheet for a Lightning invoice. Exported so both the invoice
 * card's Share button and the AI assistant ("share" command) trigger the exact
 * same flow. Returns true if the share sheet opened.
 */
export async function shareLightningInvoice(params: {
  invoice: string;
  amount: number;
  description?: string;
}): Promise<boolean> {
  const { invoice, amount, description } = params;
  const message = `⚡️ Lightning Invoice\n\n💰 Amount: ${amount.toLocaleString()} sats\n${
    description ? `📝 Description: ${description}\n` : ''
  }\n🧾 Invoice:\n${invoice}`;
  return sharePayable(invoice, 'Lightning Invoice', message);
}

/**
 * Share any payable string (invoice / address / RGB invoice) via the native share
 * sheet. Uses React Native's Share (expo-sharing only handles file URIs, so it
 * silently no-ops on plain text — the original bug). Falls back to clipboard.
 */
export async function sharePayable(value: string, label = 'Payment', message?: string): Promise<boolean> {
  try {
    const res = await Share.share(
      { message: message ?? value, ...(Platform.OS === 'ios' ? {} : { title: label }) },
      { dialogTitle: `Share ${label}` },
    );
    if (res.action === Share.dismissedAction) return false;
    return true;
  } catch {
    try { Clipboard.setString(value); } catch { /* noop */ }
    return false;
  }
}

interface InvoiceQRCodeProps {
  invoice: string;
  amount: number;
  description?: string;
  expirySeconds?: number;
  onCopy?: () => void;
  onShare?: () => void;
}

const { width: screenWidth } = Dimensions.get('window');
// Keep the QR compact so the whole invoice card fits on screen without scrolling.
const QR_SIZE = Math.min(screenWidth - 160, 180);

export default function InvoiceQRCode({ 
  invoice, 
  amount, 
  description,
  expirySeconds = 3600,
  onCopy,
  onShare 
}: InvoiceQRCodeProps) {
  const [isSharing, setIsSharing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [timeLeft, setTimeLeft] = useState(expirySeconds);
  const [copyAnimation] = useState(new Animated.Value(0));
  const [shareAnimation] = useState(new Animated.Value(0));

  // Format time remaining
  const formatTimeLeft = useCallback(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [timeLeft]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Truncate invoice for display
  const truncatedInvoice = invoice.length > 30 
    ? `${invoice.slice(0, 15)}...${invoice.slice(-15)}`
    : invoice;

  const animateSuccess = (animation: Animated.Value) => {
    Animated.sequence([
      Animated.timing(animation, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(1000),
      Animated.timing(animation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const copyToClipboard = () => {
    Clipboard.setString(invoice);
    animateSuccess(copyAnimation);
    onCopy?.();
  };

  const shareInvoice = async () => {
    setIsSharing(true);
    try {
      const opened = await shareLightningInvoice({ invoice, amount, description });
      if (opened) {
        animateSuccess(shareAnimation);
        onShare?.();
      } else {
        animateSuccess(copyAnimation);
        Alert.alert('Shared!', 'Invoice copied to clipboard (sharing not available)');
      }
    } catch (error) {
      console.error('Share error:', error);
      Alert.alert('Error', 'Could not share invoice');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(255,255,255,0.9)', 'rgba(240,253,244,0.95)']}
        style={styles.gradientContainer}
      >
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            <Ionicons name="flash" size={24} color={theme.colors.success[600]} />
            <Text style={styles.title}>Lightning Invoice</Text>
          </View>
          <View style={styles.expiryContainer}>
            <Ionicons name="time-outline" size={16} color={theme.colors.warning[600]} />
            <Text style={styles.expiryText}>
              Expires in {formatTimeLeft()}
            </Text>
          </View>
        </View>
        
        <View style={styles.qrContainer}>
          <LinearGradient
            colors={['#ffffff', '#f8fafc']}
            style={styles.qrWrapper}
          >
            <QRCode
              value={invoice}
              size={QR_SIZE}
              backgroundColor="white"
              color="#1a1a1a"
              quietZone={16}
            />
          </LinearGradient>
        </View>
        
        <View style={styles.infoContainer}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Amount:</Text>
            <Text style={styles.infoValue}>
              <Text style={styles.amountText}>{amount.toLocaleString()}</Text>
              <Text style={styles.unitText}> sats</Text>
            </Text>
          </View>
          
          {description && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Description:</Text>
              <Text style={styles.infoValue} numberOfLines={2}>{description}</Text>
            </View>
          )}

          <Pressable 
            style={styles.invoiceRow}
            onPress={() => setIsExpanded(!isExpanded)}
          >
            <Text style={styles.infoLabel}>Invoice:</Text>
            <View style={styles.invoiceTextContainer}>
              <Text style={[styles.invoiceText, isExpanded && styles.expandedInvoice]}>
                {isExpanded ? invoice : truncatedInvoice}
              </Text>
              <Ionicons 
                name={isExpanded ? "chevron-up" : "chevron-down"} 
                size={16} 
                color={theme.colors.primary[500]}
                style={styles.expandIcon}
              />
            </View>
          </Pressable>
        </View>

        <View style={styles.actionsContainer}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={copyToClipboard}
          >
            <LinearGradient
              colors={theme.colors.primary.gradient!}
              style={styles.actionGradient}
            >
              <Animated.View style={{
                transform: [{
                  scale: copyAnimation.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [1, 1.2, 1],
                  }),
                }],
              }}>
                <Ionicons name="copy" size={18} color="white" />
              </Animated.View>
              <Text style={styles.actionText}>Copy</Text>
            </LinearGradient>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={shareInvoice}
            disabled={isSharing}
          >
            <LinearGradient
              colors={theme.colors.success.gradient!}
              style={styles.actionGradient}
            >
              <Animated.View style={{
                transform: [{
                  scale: shareAnimation.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [1, 1.2, 1],
                  }),
                }],
              }}>
                <Ionicons 
                  name={isSharing ? "hourglass" : "share-social"} 
                  size={18} 
                  color="white" 
                />
              </Animated.View>
              <Text style={styles.actionText}>
                {isSharing ? 'Sharing...' : 'Share'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
        
        <Text style={styles.hint}>
          💡 Scan this QR code with any Lightning wallet to pay the invoice
        </Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.xl,
    marginVertical: theme.spacing[2],
    overflow: 'hidden',
    ...theme.shadows.lg,
  },
  gradientContainer: {
    padding: theme.spacing[3],
  },
  header: {
    marginBottom: theme.spacing[2],
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[2],
  },
  title: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.success[700],
    marginLeft: theme.spacing[2],
    letterSpacing: 0.5,
  },
  expiryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.warning[50],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    alignSelf: 'center',
  },
  expiryText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning[700],
    fontWeight: '600',
    marginLeft: theme.spacing[1],
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[3],
  },
  qrWrapper: {
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    ...theme.shadows.md,
  },
  infoContainer: {
    marginBottom: theme.spacing[3],
    backgroundColor: 'rgba(255,255,255,0.5)',
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[2],
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16,34,23,0.10)',
  },
  infoLabel: {
    fontSize: theme.typography.fontSize.sm,
    // Card is a fixed white "receipt" — force dark text regardless of app theme.
    color: '#3D5A4A',
    fontWeight: '500',
    minWidth: 80,
  },
  infoValue: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: '#102217',
    fontWeight: '600',
    textAlign: 'right',
  },
  amountText: {
    fontSize: theme.typography.fontSize.lg,
    color: theme.colors.success[700],
    fontWeight: '700',
  },
  unitText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.success[600],
    fontWeight: '600',
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  invoiceTextContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  invoiceText: {
    fontSize: theme.typography.fontSize.xs,
    color: '#3D5A4A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'right',
    flex: 1,
  },
  expandedInvoice: {
    fontSize: theme.typography.fontSize.xs,
    lineHeight: 20,
  },
  expandIcon: {
    marginLeft: theme.spacing[1],
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
  actionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.typography.fontSize.sm,
    color: 'white',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: theme.typography.fontSize.sm,
    color: '#475C51',
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 20,
  },
}); 