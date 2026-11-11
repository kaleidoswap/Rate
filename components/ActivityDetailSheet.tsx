// components/ActivityDetailSheet.tsx
//
// Bottom-sheet modal for a single activity item. Shows full detail: amount,
// status, network layer, timestamp, fee, and a copyable txid/payment hash.
// Pending on-chain items get an "Accelerate" action (AccelerationPanel).
import React, { useEffect, useMemo, useState } from 'react';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppSelector } from '../store/hooks';
import { formatBitcoinAmount, formatSatoshisToUSD } from '../utils/bitcoinUnits';
import { activityAmountPrefix, activityIcon, activityTypeLabel, activityToneColor } from '../utils/activity-presentation';
import { useFiatRates } from '../hooks/useFiatRates';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Platform,
    Linking,
    Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme';
import { LAYER_LABEL, layerNetworkIcon } from '../utils/activity-layers';
import { NetworkIcon } from './NetworkIcon';
import { CopyButton } from './CopyButton';
import type { ActivityItem, ActivityItemType, ActivityLayer } from '../services/ActivityService';
import { ACTIVITY_STATUS_VISUAL } from '../utils/paymentStatus';
import { AccelerationPanel } from './AccelerationPanel';
import { accelerationTarget } from '../services/TxAccelerationService';
import { findPaymentProof } from '../services/paymentProofs';
import { preimageMatches } from '../utils/payment-proofs';
import { chainLabel } from '../utils/orchestra-ui';
import { formatRecordAmount } from '../utils/crosschain-history';
import { activityExplorerUrl } from '../utils/explorer';
import { RGB_TRANSFER_STATUS_LABEL, canCancelRgbTransfer, rgbOnchainKindLabel, canDeleteRgbTransfer, rgbTransferStatusDetail, rgbWalletErrorMessage, rgbWalletSupport } from '../utils/rgb-wallet';
import { cancelRgbTransfer, deleteRgbTransfer } from '../services/rgbWallet';
import { rgbAccountAdapter } from '../services/protocols';
import { middleEllipsis } from './receive/ReceiveRequestDetails';

interface Props {
    item: ActivityItem | null;
    onClose: () => void;
    onRefresh?: () => Promise<boolean | void>;
}

// Type names, icons and signs come from utils/activity-presentation, shared
// with the Activity rows and the dashboard widget: one payment, one story.
const typeLabel = activityTypeLabel;
const amountPrefix = activityAmountPrefix;


export const ActivityDetailSheet: React.FC<Props> = ({ item, onClose, onRefresh }) => {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const unit = useAppSelector(state => state.settings.bitcoinUnit);
    const usdRate = useFiatRates().usd;
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const [cancelledId, setCancelledId] = useState<string | null>(null);
    useEffect(() => { setDetailsExpanded(false); setCancelledId(null); }, [item?.id]);
    const [accelerating, setAccelerating] = useState(false);
    useEffect(() => setAccelerating(false), [item?.id]);
    const [cancelling, setCancelling] = useState(false);
    const [cancelMessage, setCancelMessage] = useState('');
    useEffect(() => { setCancelling(false); setCancelMessage(''); }, [item?.id]);
    // The preimage: from the account's history, else the proof kept when this phone paid.
    const [proof, setProof] = useState<{ preimage: string; paymentHash?: string } | null>(null);
    useEffect(() => {
        setProof(null);
        if (!item || item.type !== 'send' || item.source !== 'payment' || item.status === 'failed') return;
        if (item.preimage) { setProof({ preimage: item.preimage, paymentHash: item.paymentHash }); return; }
        let live = true;
        findPaymentProof([item.paymentHash, item.txid, item.requestId])
            .then(p => { if (live && p) setProof({ preimage: p.preimage, paymentHash: p.paymentHash }); })
            .catch(() => {});
        return () => { live = false; };
    }, [item]);
    if (!item) return null;

    const v = activityIcon(item.type);
    const vColor = activityToneColor(v.tone, theme);
    const cancelled = cancelledId === item.id;
    const st = ACTIVITY_STATUS_VISUAL[cancelled ? 'failed' : item.status];
    const onchain = item.source === 'onchain' || item.layer === 'L1' || item.layer === 'RGB-L1';
    // One status vocabulary everywhere: the same label the rows show.
    const statusLabel = cancelled ? 'Cancelled' : st.label;
    const hasAmount = item.amount !== '';
    const isIncoming = item.type === 'receive' || item.type === 'issuance';
    const txLabel = item.crossChain ? 'Order ID' : item.paymentHash ? 'Payment hash' : 'Transaction ID';
    const cc = item.crossChain;
    // Spark's history id isn't the payment hash; the proof brings the real one.
    const proofHash = proof?.paymentHash ?? item.paymentHash;
    const proofVerified = !!proof && !!proofHash && preimageMatches(proof.preimage, proofHash);
    const target = accelerationTarget(item);
    const explorerUrl = activityExplorerUrl(item);
    const rgb = item.rgbTransfer && cancelled ? { ...item.rgbTransfer, status: 'failed' as const } : item.rgbTransfer;
    const rgbAdapter = rgb ? rgbAccountAdapter() : null;
    const rgbSupport = rgbWalletSupport(rgbAdapter);
    const cancellable = !!rgb && canCancelRgbTransfer(rgb, rgbSupport);
    const removable = !!rgb && canDeleteRgbTransfer(rgb, rgbSupport);
    const rgbSettled = rgb?.status === 'settled';
    const statusDetail = rgb ? (rgbSettled ? '' : rgbTransferStatusDetail(rgb.status, rgb.direction))
        : item.status === 'unknown' ? 'The provider has not confirmed the outcome. Check the status before paying again.'
        : item.status === 'pending' ? 'Submitted and waiting for confirmation. You can leave this screen and check again later.'
        : onchain && item.status === 'confirmed' ? 'Included in a Bitcoin block.' : '';
    // Method, account and network in one line: "RGB · mutinynet", the account only when it says more.
    const accountName = item.account ?? (['LN', 'RGB-LN', 'RGB-L1', 'L1'].includes(item.layer) ? 'RGB' : item.layer);
    const methodText = [LAYER_LABEL[item.layer], accountName !== LAYER_LABEL[item.layer] && accountName !== item.layer ? accountName : null, item.network]
        .filter(Boolean).join(' · ');
    const assetId = item.asset && item.asset !== 'BTC' && !item.crossChain ? item.asset : '';
    const assetTitle = item.assetName && item.assetTicker && item.assetName !== item.assetTicker ? `${item.assetName} (${item.assetTicker})` : item.assetName || item.assetTicker;
    const details: { key: string; label: string; value: React.ReactNode }[] = [];
    if (item.contactName) details.push({ key: 'contact', label: item.type === 'receive' ? 'From' : 'Recipient', value: <Text style={styles.rowValue}>{item.contactName}</Text> });
    if (assetId || item.assetName) details.push({ key: 'asset', label: 'Asset', value: <Text style={styles.rowValue} numberOfLines={1}>{assetTitle}</Text> });
    if (assetId) details.push({ key: 'asset-id', label: 'Asset ID', value: <View style={styles.rowWithAction}>
        <Text style={styles.monoValue} selectable numberOfLines={1}>{middleEllipsis(assetId, 12, 8)}</Text>
        <CopyButton value={assetId} size={14} />
    </View> });
    details.push({ key: 'method', label: 'Method', value: <View style={styles.layerChip}>
        {layerNetworkIcon(item.layer) && <NetworkIcon network={layerNetworkIcon(item.layer)!} size={14} />}
        <Text style={styles.layerChipText} numberOfLines={1}>{methodText}</Text>
    </View> });
    if (item.timestamp != null) details.push({ key: 'date', label: 'Date', value: <Text style={styles.rowValue}>
        {new Date(item.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </Text> });
    if (item.fee != null) details.push({ key: 'fee', label: 'Fee', value: <View style={styles.rowWithAction}>
        <Text style={styles.rowValue}>{`${formatBitcoinAmount(item.fee, unit)} ${unit}`}</Text>
    </View> });
    if (item.txid) details.push({ key: 'txid', label: txLabel, value: <View style={styles.rowWithAction}>
        <Text style={styles.monoValue} selectable numberOfLines={1}>{middleEllipsis(item.txid, 8, 8)}</Text>
        <CopyButton value={item.txid} size={14} />
        {explorerUrl && <TouchableOpacity accessibilityRole="link" accessibilityLabel="View in explorer" hitSlop={8} onPress={() => Linking.openURL(explorerUrl).catch(() => {})}>
            <Ionicons name="open-outline" size={16} color={theme.colors.primary[500]} />
        </TouchableOpacity>}
    </View> });
    const removeTransfer = () => {
        if (!rgb || rgb.batchTransferIdx == null) return;
        Alert.alert(
            'Remove from history?',
            'This failed transfer moved nothing. Removing it only tidies your history.',
            [
                { text: 'Keep', style: 'cancel' },
                {
                    text: 'Remove', style: 'destructive', onPress: async () => {
                        setCancelling(true); setCancelMessage('');
                        try {
                            const removed = await deleteRgbTransfer(rgbAdapter, rgb.batchTransferIdx!);
                            if (!removed) { setCancelMessage('This transfer can’t be removed.'); return; }
                            await onRefresh?.();
                            onClose();
                        } catch (e) {
                            setCancelMessage(rgbWalletErrorMessage(e, 'delete'));
                        } finally {
                            setCancelling(false);
                        }
                    },
                },
            ],
        );
    };
    const cancelTransfer = () => {
        if (!rgb || rgb.batchTransferIdx == null) return;
        Alert.alert(
            rgb.direction === 'incoming' ? 'Cancel this invoice?' : 'Cancel this transfer?',
            rgb.direction === 'incoming'
                ? 'Anything sent to it afterwards won’t be received. Make a new invoice if you still want the asset.'
                : 'The recipient hasn’t accepted it yet. Cancelling frees the asset to send again.',
            [
                { text: 'Keep', style: 'cancel' },
                {
                    text: 'Cancel transfer', style: 'destructive', onPress: async () => {
                        setCancelling(true); setCancelMessage('');
                        try {
                            const failed = await cancelRgbTransfer(rgbAdapter, rgb.batchTransferIdx!);
                            if (failed) setCancelledId(item.id);
                            setCancelMessage(failed ? 'Cancelled.' : 'This transfer can no longer be cancelled.');
                            if (failed) {
                                try { await onRefresh?.(); } catch { /* Cancellation already succeeded. */ }
                            } else { await onRefresh?.(); }
                        } catch (e) {
                            setCancelMessage(rgbWalletErrorMessage(e, 'cancel'));
                        } finally {
                            setCancelling(false);
                        }
                    },
                },
            ],
        );
    };

    return (
        <Modal
            visible
            animationType="slide"
            presentationStyle="formSheet"
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                <View style={styles.handle} />

                {accelerating && target ? (
                    <ScrollView contentContainerStyle={styles.body}>
                        <AccelerationPanel target={target} onBack={() => setAccelerating(false)} />
                    </ScrollView>
                ) : (<>
                <ScrollView contentContainerStyle={styles.body}>
                {/* Icon + type + amount */}
                <View style={styles.header}>
                    <View style={[styles.bigIcon, { backgroundColor: vColor + '1A' }]}>
                        <Ionicons name={v.icon} size={26} color={vColor} />
                    </View>
                    <Text style={styles.typeLabel}>{typeLabel(item)}</Text>
                    {hasAmount && (
                        <View style={styles.amountColumn}>
                            <Text style={[styles.amount, { color: isIncoming ? theme.colors.tx.receive : theme.colors.text.primary }]}>
                                {cancelled || item.status === 'failed' ? '' : amountPrefix(item.type)}{item.rawSats != null ? `${formatBitcoinAmount(item.rawSats, unit)} ${unit}` : `${item.amount} ${item.assetTicker}`}
                            </Text>
                            {item.rawSats != null && !!usdRate && (
                                <Text style={styles.amountFiat}>≈ ${formatSatoshisToUSD(item.rawSats, usdRate)}</Text>
                            )}
                        </View>
                    )}
                    {/* Status: an RGB transfer's own step reads better than "Confirmed on-chain" + "Settled". */}
                    <View style={styles.headerStatus}>
                        <View style={[styles.statusPill, { backgroundColor: st.color + '1A' }]}>
                            <View style={[styles.statusDot, { backgroundColor: st.color }]} />
                            <Text style={[styles.statusText, { color: st.color }]}>{cancelled ? 'Cancelled' : rgb && rgb.status !== 'settled' ? RGB_TRANSFER_STATUS_LABEL[rgb.status] : statusLabel}</Text>
                        </View>
                    </View>
                    {!!statusDetail && <Text style={styles.statusDetail}>{statusDetail}</Text>}
                </View>

                    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: detailsExpanded }} style={styles.closeButton} onPress={() => setDetailsExpanded(!detailsExpanded)}>
                        <Text style={styles.closeButtonText}>{detailsExpanded ? 'Hide details' : 'Payment details'}</Text>
                    </TouchableOpacity>
                    {detailsExpanded && <>
                    <View style={styles.card}>
                        {details.map((row, i) => <View key={row.key} style={[styles.row, i > 0 && styles.rowDivider]}>
                            <Text style={styles.rowLabel}>{row.label}</Text>
                            {row.value}
                        </View>)}
                    </View>

                    {cc && (
                        <>
                            <View style={[styles.card, styles.row]}>
                                <Text style={styles.rowLabel}>Route</Text>
                                <View style={styles.layerChip}>
                                    <NetworkIcon network={cc.sourceChain} size={14} />
                                    <Text style={styles.layerChipText}>{cc.sourceAsset} on {chainLabel(cc.sourceChain)}</Text>
                                    <Ionicons name="arrow-forward" size={12} color={theme.colors.text.tertiary} />
                                    <NetworkIcon network={cc.destChain} size={14} />
                                    <Text style={styles.layerChipText}>{cc.destAsset} on {chainLabel(cc.destChain)}</Text>
                                </View>
                            </View>
                            {!!cc.amountOutRaw && (
                                <View style={[styles.card, styles.row]}>
                                    <Text style={styles.rowLabel}>{cc.direction === 'deposit' ? 'You receive' : 'They receive'}</Text>
                                    <Text style={styles.rowValue}>
                                        {cc.status === 'completed' ? '' : '≈ '}{formatRecordAmount(cc.amountOutRaw, cc.destDecimals, cc.destAsset)}
                                    </Text>
                                </View>
                            )}
                            {!!cc.recipient && (
                                <View style={styles.txidBlock}>
                                    <View style={styles.txidHeader}>
                                        <Text style={styles.rowLabel}>Recipient</Text>
                                        <CopyButton value={cc.recipient} label="Copy" size={14} />
                                    </View>
                                    <Text style={styles.txidText} selectable numberOfLines={2}>{cc.recipient}</Text>
                                </View>
                            )}
                            {cc.status === 'unpaid' && (
                                <Text style={styles.rowLabel}>The payment from Spark wasn't confirmed. Open Send to check this transfer before sending again.</Text>
                            )}
                        </>
                    )}

                    {proof && (
                        <View style={styles.txidBlock}>
                            <View style={styles.txidHeader}>
                                <Text style={styles.rowLabel}>Preimage (proof of payment)</Text>
                                <CopyButton value={proof.preimage} label="Copy" size={14} />
                            </View>
                            <Text style={styles.txidText} selectable numberOfLines={3}>{proof.preimage}</Text>
                            {proofVerified && (
                                <View style={styles.proofRow}>
                                    <Ionicons name="checkmark-circle" size={14} color={theme.colors.success[500]} />
                                    <Text style={styles.proofText}>Matches the payment hash</Text>
                                </View>
                            )}
                            {!!proofHash && proofHash !== item.txid && (
                                <>
                                    <View style={[styles.txidHeader, { marginTop: theme.spacing[3] }]}>
                                        <Text style={styles.rowLabel}>Payment hash</Text>
                                        <CopyButton value={proofHash} label="Copy" size={14} />
                                    </View>
                                    <Text style={styles.txidText} selectable numberOfLines={3}>{proofHash}</Text>
                                </>
                            )}
                        </View>
                    )}
                    </>}
                    {cancellable && (
                        <TouchableOpacity accessibilityRole="button" style={styles.closeButton} disabled={cancelling} onPress={cancelTransfer} activeOpacity={0.8}>
                            <Text style={[styles.closeButtonText, { color: theme.colors.error[500] }]}>{cancelling ? 'Cancelling…' : rgb?.direction === 'incoming' ? 'Cancel invoice' : 'Cancel transfer'}</Text>
                        </TouchableOpacity>
                    )}
                    {rgb && item.status === 'pending' && !cancelled && !cancellable && <Text style={styles.rowLabel}>
                        {rgb.status === 'waiting-counterparty'
                            ? 'Cancellation is unavailable for this account. Check the transfer in the connected RGB wallet.'
                            : 'This transfer cannot be cancelled at this stage. Check its status for updates.'}
                    </Text>}
                    {removable && (
                        <TouchableOpacity accessibilityRole="button" style={styles.closeButton} disabled={cancelling} onPress={removeTransfer} activeOpacity={0.8}>
                            <Text style={[styles.closeButtonText, { color: theme.colors.error[500] }]}>{cancelling ? 'Removing…' : 'Remove from history'}</Text>
                        </TouchableOpacity>
                    )}
                    {!!cancelMessage && <Text accessibilityLiveRegion="polite" style={styles.rowLabel}>{cancelMessage}</Text>}
                    {target && (
                        <TouchableOpacity style={styles.accelerateButton} onPress={() => setAccelerating(true)} activeOpacity={0.8}>
                            <Ionicons name="rocket-outline" size={18} color={theme.colors.primary[500]} />
                            <Text style={styles.accelerateButtonText}>Accelerate</Text>
                        </TouchableOpacity>
                    )}

                </ScrollView>
                </>)}

                <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8}>
                    <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
            </View>
        </Modal>
    );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.primary,
        paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.border.medium,
        marginTop: theme.spacing[3],
        marginBottom: theme.spacing[2],
    },
    rowWithAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
        flexShrink: 1,
        justifyContent: 'flex-end',
    },
    header: {
        alignItems: 'center',
        paddingVertical: theme.spacing[4],
        paddingHorizontal: theme.spacing[4],
        gap: theme.spacing[1.5],
    },
    bigIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing[1],
    },
    typeLabel: {
        fontSize: theme.typography.fontSize.xl,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    amount: {
        fontSize: theme.typography.fontSize['2xl'],
        fontWeight: '800',
    },
    amountColumn: {
        alignItems: 'center',
        gap: 2,
    },
    amountFiat: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.tertiary,
    },
    body: {
        paddingHorizontal: theme.spacing[4],
        paddingTop: theme.spacing[3],
        gap: theme.spacing[2],
        paddingBottom: theme.spacing[4],
    },
    card: {
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: theme.spacing[4],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.spacing[3],
        paddingVertical: theme.spacing[3],
    },
    rowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.light,
    },
    monoValue: {
        fontSize: theme.typography.fontSize.xs,
        fontFamily: theme.typography.fontFamily.mono,
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    headerStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
        marginTop: theme.spacing[1],
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing[3],
        paddingVertical: theme.spacing[1],
        borderRadius: theme.borderRadius.full,
    },
    statusDetail: {
        fontSize: theme.typography.fontSize.sm,
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
    rowLabel: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    rowValue: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.text.primary,
        flexShrink: 1,
        textAlign: 'right',
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '700',
    },
    layerChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[1],
        paddingHorizontal: theme.spacing[2],
        paddingVertical: 3,
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.surface.tertiary,
    },
    layerChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.text.secondary,
    },
    proofRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: theme.spacing[2],
    },
    proofText: {
        fontSize: theme.typography.fontSize.xs,
        color: theme.colors.success[500],
        fontWeight: '600',
    },
    txidBlock: {
        backgroundColor: theme.colors.surface.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing[4],
        gap: theme.spacing[2],
        borderWidth: 1,
        borderColor: theme.colors.border.light,
    },
    txidHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: theme.spacing[2],
    },
    txidText: {
        fontSize: theme.typography.fontSize.xs,
        fontFamily: theme.typography.fontFamily.mono,
        color: theme.colors.text.secondary,
        lineHeight: 18,
    },
    explorerLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[1],
        marginTop: theme.spacing[1],
    },
    explorerLinkText: {
        fontSize: theme.typography.fontSize.sm,
        fontWeight: '600',
        color: theme.colors.primary[500],
    },
    accelerateButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing[2],
        marginTop: theme.spacing[2],
        paddingVertical: theme.spacing[3.5],
        borderRadius: theme.borderRadius.xl,
        borderWidth: 1,
        borderColor: theme.colors.primary[500],
    },
    accelerateButtonText: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.primary[500],
    },
    closeButton: {
        marginHorizontal: theme.spacing[4],
        marginTop: theme.spacing[2],
        paddingVertical: theme.spacing[4],
        borderRadius: theme.borderRadius.xl,
        backgroundColor: theme.colors.surface.secondary,
        alignItems: 'center',
    },
    closeButtonText: {
        fontSize: theme.typography.fontSize.base,
        fontWeight: '600',
        color: theme.colors.text.primary,
    },
});

export default ActivityDetailSheet;
