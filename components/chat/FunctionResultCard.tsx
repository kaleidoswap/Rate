// components/chat/FunctionResultCard.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, Platform } from 'react-native';
import InvoiceQRCode from '../InvoiceQRCode';
import { useAppTheme } from '../../theme/ThemeProvider';
import { formatDistance } from '../../services/btcmapService';
import type { Theme } from '../../theme';

/** Open a merchant in the native maps app — by coordinates if we have them,
 *  otherwise by a search query on its name/address. */
const openMaps = (merchant: { name?: string; address?: string; lat?: number; lon?: number }) => {
  let url: string;
  if (typeof merchant.lat === 'number' && typeof merchant.lon === 'number') {
    const label = encodeURIComponent(merchant.name || 'Merchant');
    url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${merchant.lat},${merchant.lon}&q=${label}`
        : `geo:${merchant.lat},${merchant.lon}?q=${merchant.lat},${merchant.lon}(${label})`;
  } else {
    const q = encodeURIComponent([merchant.name, merchant.address].filter(Boolean).join(' '));
    url = `https://www.openstreetmap.org/search?query=${q}`;
  }
  Linking.openURL(url).catch(() => {});
};

/** A single merchant row used by both the list and the detail cards. */
const MerchantRow: React.FC<{
  merchant: any;
  styles: ReturnType<typeof makeStyles>;
  onOpenLink: (url: string) => void;
  openMaps: typeof openMaps;
  expanded?: boolean;
}> = ({ merchant, styles, onOpenLink, openMaps, expanded }) => (
  <View style={styles.merchantItem}>
    <View style={styles.merchantHeader}>
      <Text style={styles.merchantName} numberOfLines={2}>
        {merchant.icon ? `${merchant.icon} ` : ''}
        {merchant.name}
      </Text>
      {typeof merchant.distance_m === 'number' && (
        <Text style={styles.merchantDistance}>{formatDistance(merchant.distance_m)}</Text>
      )}
    </View>
    {!!merchant.address && <Text style={styles.merchantAddress}>{merchant.address}</Text>}
    {!!merchant.opening_hours && (
      <Text style={styles.merchantHours}>🕒 {merchant.opening_hours}</Text>
    )}
    {(merchant.accepts_lightning || merchant.accepts_bitcoin) && (
      <Text style={styles.merchantPay}>
        {merchant.accepts_lightning ? '⚡ Lightning' : ''}
        {merchant.accepts_lightning && merchant.accepts_bitcoin ? '  ·  ' : ''}
        {merchant.accepts_bitcoin ? '₿ On-chain' : ''}
      </Text>
    )}
    <View style={styles.merchantActions}>
      <TouchableOpacity onPress={() => openMaps(merchant)} style={styles.mapsButton}>
        <Text style={styles.mapsButtonText}>🗺️ Map</Text>
      </TouchableOpacity>
      {!!merchant.phone && (
        <TouchableOpacity onPress={() => Linking.openURL(`tel:${merchant.phone}`)}>
          <Text style={styles.merchantLink}>📞 {expanded ? merchant.phone : 'Call'}</Text>
        </TouchableOpacity>
      )}
      {!!merchant.website && (
        <TouchableOpacity onPress={() => onOpenLink(merchant.website)}>
          <Text style={styles.merchantLink}>🌐 Website</Text>
        </TouchableOpacity>
      )}
    </View>
  </View>
);

interface FunctionResultCardProps {
  functionCalled: string;
  functionResult: any;
  /** Copy a string and surface a toast. */
  onCopy: (text: string, label?: string) => void;
  /** Open an external URL. */
  onOpenLink: (url: string) => void;
}

/**
 * Renders the structured result of an assistant tool call (balance, invoice,
 * receive address, merchants, transactions). Extracted from AIAssistantScreen's
 * inline renderFunctionResult so each card is theme-aware and reusable.
 */
const FunctionResultCard: React.FC<FunctionResultCardProps> = ({
  functionCalled,
  functionResult,
  onCopy,
  onOpenLink,
}) => {
  const theme = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  if (!functionResult) return null;

  switch (functionCalled) {
    case 'pay_lightning_invoice':
      return (
        <View style={styles.card}>
          <Text style={styles.title}>💸 Payment Result</Text>
          {functionResult.success ? (
            <View>
              <Text style={styles.successText}>✅ Payment successful!</Text>
              <TouchableOpacity
                onPress={() => onCopy(functionResult.payment_hash, 'Payment hash')}
                style={styles.copyButton}
                accessibilityRole="button"
                accessibilityLabel="Copy payment hash"
              >
                <Text style={styles.copyText}>📋 Copy Payment Hash</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.errorText}>❌ {functionResult.error}</Text>
          )}
        </View>
      );

    // Invoice generation. Covers the legacy `generate_invoice` shape
    // ({success, invoice, amount_sats}) and the canonical wallet-contract tools
    // (spark_create_invoice / rln_create_ln_invoice / rln_create_rgb_invoice),
    // whose result is the wallet-engine Invoice ({invoice, amount, description}).
    case 'generate_invoice':
    case 'spark_create_invoice':
    case 'rln_create_ln_invoice':
    case 'rln_create_rgb_invoice': {
      const invoice = functionResult.invoice;
      const amount = Number(functionResult.amount_sats ?? functionResult.amount ?? 0);
      return invoice ? (
        <InvoiceQRCode
          invoice={invoice}
          amount={amount}
          description={functionResult.description}
          onCopy={() => onCopy(invoice, 'Invoice')}
          onShare={() => {}}
        />
      ) : (
        <View style={styles.card}>
          <Text style={styles.title}>🧾 Invoice Generation Failed</Text>
          <Text style={styles.errorText}>❌ {functionResult.error || 'Could not generate an invoice.'}</Text>
        </View>
      );
    }

    case 'find_merchant_locations': {
      const merchants: any[] = functionResult.merchants ?? [];
      return (
        <View style={styles.card}>
          <Text style={styles.title}>
            🏪 {merchants.length} Bitcoin Merchant{merchants.length === 1 ? '' : 's'} Nearby
          </Text>
          {functionResult.success ? (
            merchants.length === 0 ? (
              <Text style={styles.invoiceText}>
                No Bitcoin merchants found in range. Try a wider radius.
              </Text>
            ) : (
              <>
                <ScrollView style={styles.merchantList} nestedScrollEnabled>
                  {merchants.map((merchant: any) => (
                    <MerchantRow
                      key={`${merchant.id}`}
                      merchant={merchant}
                      styles={styles}
                      onOpenLink={onOpenLink}
                      openMaps={openMaps}
                    />
                  ))}
                </ScrollView>
                <Text style={styles.attribution}>
                  {functionResult.source === 'offline'
                    ? '⚠︎ Offline list — couldn’t reach BTC Map or your location'
                    : `via BTC Map${functionResult.precise_location ? ' · near your location' : ' · default area'}`}
                </Text>
              </>
            )
          ) : (
            <Text style={styles.errorText}>❌ {functionResult.error}</Text>
          )}
        </View>
      );
    }

    case 'get_merchant_info':
      return (
        <View style={styles.card}>
          <Text style={styles.title}>📍 Merchant Info</Text>
          {functionResult.success ? (
            <MerchantRow
              merchant={functionResult.merchant}
              styles={styles}
              onOpenLink={onOpenLink}
              openMaps={openMaps}
              expanded
            />
          ) : (
            <Text style={styles.errorText}>❌ {functionResult.error}</Text>
          )}
        </View>
      );

    case 'get_wallet_balance':
      return functionResult.success ? (
        <View style={styles.card}>
          <Text style={styles.title}>💰 Wallet Balance</Text>
          <Text style={styles.balanceAmount}>
            {Number(functionResult.btc_sats || 0).toLocaleString()} sats
          </Text>
          {functionResult.btc_pending_sats > 0 && (
            <Text style={styles.balanceSub}>
              {Number(functionResult.btc_pending_sats).toLocaleString()} sats pending
            </Text>
          )}
          {Array.isArray(functionResult.assets) && functionResult.assets.length > 0 && (
            <View style={styles.assetRows}>
              {functionResult.assets.map((a: any, i: number) => (
                <View key={`${a.ticker}-${i}`} style={styles.assetRow}>
                  <Text style={styles.assetTicker}>{a.ticker}</Text>
                  <Text style={styles.assetBalance}>{a.balance}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.errorText}>❌ {functionResult.error}</Text>
        </View>
      );

    case 'get_receive_address':
      return functionResult.success ? (
        <View style={styles.card}>
          <Text style={styles.title}>📥 Receive Address</Text>
          <TouchableOpacity
            onPress={() => onCopy(functionResult.address, 'Address')}
            accessibilityRole="button"
            accessibilityLabel="Copy receive address"
          >
            <Text style={styles.addressText}>{functionResult.address}</Text>
            <Text style={styles.copyText}>📋 Tap to copy</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.errorText}>❌ {functionResult.error}</Text>
        </View>
      );

    case 'list_recent_transactions':
      return functionResult.success ? (
        <View style={styles.card}>
          <Text style={styles.title}>📜 Recent Transactions</Text>
          {(functionResult.transactions || []).length === 0 ? (
            <Text style={styles.invoiceText}>No recent transactions.</Text>
          ) : (
            functionResult.transactions.map((t: any, i: number) => (
              <View key={i} style={styles.txRow}>
                <Text style={styles.txDirection}>
                  {t.direction === 'received' ? '↓ Received' : '↑ Sent'}
                </Text>
                <Text style={styles.txAmount}>
                  {Number(t.amount_sats || 0).toLocaleString()} sats
                </Text>
              </View>
            ))
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.errorText}>❌ {functionResult.error}</Text>
        </View>
      );

    default:
      return null;
  }
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      marginTop: theme.spacing[3],
      padding: theme.spacing[3],
      backgroundColor: theme.colors.surface.highlight,
      borderRadius: theme.borderRadius.md,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary[500],
    },
    title: {
      fontSize: theme.typography.fontSize.sm,
      fontWeight: '600',
      color: theme.colors.primary[400] ?? theme.colors.primary[500],
      marginBottom: theme.spacing[2],
      letterSpacing: 0.5,
    },
    successText: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.success[500] ?? theme.colors.success[600],
      fontWeight: '500',
      marginBottom: theme.spacing[1],
    },
    errorText: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.error[400] ?? theme.colors.error[500],
      fontWeight: '500',
    },
    invoiceText: {
      fontSize: theme.typography.fontSize.sm,
      lineHeight: 20,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing[2],
    },
    copyButton: {
      alignSelf: 'flex-start',
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      backgroundColor: theme.colors.primary[100] ?? theme.colors.surface.secondary,
      borderRadius: theme.borderRadius.sm,
      marginTop: theme.spacing[1],
    },
    copyText: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.primary[400] ?? theme.colors.primary[500],
      fontWeight: '500',
    },
    merchantList: { maxHeight: 280 },
    merchantItem: {
      padding: theme.spacing[2],
      backgroundColor: theme.colors.surface.primary,
      borderRadius: theme.borderRadius.sm,
      marginBottom: theme.spacing[2],
      borderWidth: 1,
      borderColor: theme.colors.border.light,
    },
    merchantHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing[2],
    },
    merchantName: {
      flex: 1,
      fontSize: theme.typography.fontSize.sm,
      fontWeight: '600',
      color: theme.colors.text.primary,
      marginBottom: theme.spacing[1],
      lineHeight: 20,
    },
    merchantDistance: {
      fontSize: theme.typography.fontSize.xs,
      fontWeight: '700',
      color: theme.colors.primary[400] ?? theme.colors.primary[500],
    },
    merchantPay: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.success[500] ?? theme.colors.success[600],
      fontWeight: '500',
      marginBottom: theme.spacing[1],
    },
    merchantActions: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing[3],
      marginTop: theme.spacing[1],
    },
    mapsButton: {
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      backgroundColor: theme.colors.primary[100] ?? theme.colors.surface.secondary,
      borderRadius: theme.borderRadius.sm,
    },
    mapsButtonText: {
      fontSize: theme.typography.fontSize.xs,
      fontWeight: '600',
      color: theme.colors.primary[400] ?? theme.colors.primary[500],
    },
    attribution: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.text.tertiary,
      marginTop: theme.spacing[1],
      fontStyle: 'italic',
    },
    merchantAddress: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing[1],
      lineHeight: 16,
    },
    merchantLink: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.primary[400] ?? theme.colors.primary[500],
      marginBottom: theme.spacing[1],
      fontWeight: '500',
      lineHeight: 16,
    },
    merchantHours: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.success[500] ?? theme.colors.success[600],
      marginBottom: theme.spacing[1],
      fontWeight: '500',
    },
    balanceAmount: {
      fontSize: theme.typography.fontSize.xl,
      fontWeight: '700',
      color: theme.colors.primary[400] ?? theme.colors.primary[500],
    },
    balanceSub: {
      fontSize: theme.typography.fontSize.xs,
      color: theme.colors.text.tertiary,
      marginTop: theme.spacing[1],
    },
    assetRows: { marginTop: theme.spacing[2], gap: theme.spacing[1] },
    assetRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing[1],
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.light,
    },
    assetTicker: {
      fontSize: theme.typography.fontSize.sm,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    assetBalance: {
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.text.secondary,
    },
    addressText: {
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.text.primary,
      fontWeight: '500',
      marginBottom: theme.spacing[1],
    },
    txRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing[2],
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.light,
    },
    txDirection: {
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.text.secondary,
      fontWeight: '500',
    },
    txAmount: {
      fontSize: theme.typography.fontSize.sm,
      color: theme.colors.text.primary,
      fontWeight: '600',
    },
  });

export default FunctionResultCard;
