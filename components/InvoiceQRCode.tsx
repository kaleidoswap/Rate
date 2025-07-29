// components/InvoiceQRCode.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Clipboard,
  Platform,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { theme } from '../theme';

interface InvoiceQRCodeProps {
  invoice: string;
  amount: number;
  description?: string;
  onCopy?: () => void;
  onShare?: () => void;
}

export default function InvoiceQRCode({ 
  invoice, 
  amount, 
  description,
  onCopy,
  onShare 
}: InvoiceQRCodeProps) {
  const [isSharing, setIsSharing] = useState(false);

  const copyToClipboard = () => {
    Clipboard.setString(invoice);
    Alert.alert('Copied!', 'Lightning invoice copied to clipboard');
    onCopy?.();
  };

  const shareInvoice = async () => {
    setIsSharing(true);
    try {
      if (await Sharing.isAvailableAsync()) {
        const shareData = {
          message: `Lightning Invoice\n\nAmount: ${amount} sats\n${description ? `Description: ${description}\n` : ''}Invoice: ${invoice}`,
          title: 'Lightning Invoice'
        };
        
        await Sharing.shareAsync('data:text/plain;base64,' + btoa(shareData.message), {
          mimeType: 'text/plain',
          dialogTitle: 'Share Lightning Invoice'
        });
        onShare?.();
      } else {
        // Fallback to clipboard
        copyToClipboard();
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
      <View style={styles.header}>
        <Ionicons name="receipt" size={20} color={theme.colors.success[600]} />
        <Text style={styles.title}>Lightning Invoice</Text>
      </View>
      
      <View style={styles.qrContainer}>
        <View style={styles.qrWrapper}>
          <QRCode
            value={invoice}
            size={180}
            backgroundColor="white"
            color="#1a1a1a"
          />
        </View>
      </View>
      
      <View style={styles.infoContainer}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Amount:</Text>
          <Text style={styles.infoValue}>{amount.toLocaleString()} sats</Text>
        </View>
        
        {description && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Description:</Text>
            <Text style={styles.infoValue}>{description}</Text>
          </View>
        )}
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity 
          style={styles.actionButton}
          onPress={copyToClipboard}
        >
          <LinearGradient
            colors={['#4F46E5', '#7C3AED']}
            style={styles.actionGradient}
          >
            <Ionicons name="copy" size={16} color="white" />
            <Text style={styles.actionText}>Copy Invoice</Text>
          </LinearGradient>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.actionButton}
          onPress={shareInvoice}
          disabled={isSharing}
        >
          <LinearGradient
            colors={['#059669', '#10B981']}
            style={styles.actionGradient}
          >
            <Ionicons 
              name={isSharing ? "hourglass" : "share"} 
              size={16} 
              color="white" 
            />
            <Text style={styles.actionText}>
              {isSharing ? 'Sharing...' : 'Share'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
      
      <Text style={styles.hint}>
        💡 Scan this QR code with any Lightning wallet to pay the invoice
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface.primary,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    marginTop: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.success[200],
    ...theme.shadows.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing[4],
    justifyContent: 'center',
  },
  title: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.success[700],
    marginLeft: theme.spacing[2],
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  qrWrapper: {
    backgroundColor: 'white',
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    ...theme.shadows.sm,
  },
  infoContainer: {
    marginBottom: theme.spacing[4],
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  infoLabel: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.primary,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    marginBottom: theme.spacing[3],
  },
  actionButton: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
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
  },
  hint: {
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.text.tertiary,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: theme.typography.lineHeight.relaxed,
  },
}); 