// components/ActivityDetailSheet.tsx
//
// Bottom-sheet modal for a single activity item: a hero (direction, amount,
// fiat, status), a details card (date, network, counterparty, ids), a fee
// card, then the actions (cancel / remove / accelerate / share / explorer).
// Pending on-chain items get an "Accelerate" action (AccelerationPanel); an
// RGB invoice or transfer still waiting for the other side can be cancelled
// where the RGB account supports it (the button is hidden where it doesn't).
import React, { useEffect, useMemo, useState } from 'react';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppSelector } from '../store/hooks';
import { formatBitcoinAmount, formatSatoshisToUSD } from '../utils/bitcoinUnits';
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
    Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme, leading } from '../theme';
import { LAYER_LABEL, layerNetworkIcon } from '../utils/activity-layers';
import { NetworkIcon } from './NetworkIcon';
import { CopyButton } from './CopyButton';
import { AmountText } from './AmountText';
import { Badge } from './Badge';
import { Button } from './Button';
import { Callout } from './Callout';
import { forgetActivityInFlight, type ActivityItem, type ActivityItemType } from '../services/ActivityService';
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
import { ExplainButton } from './mind/ExplainSheet';
import { middleEllipsis } from './receive/ReceiveRequestDetails';

interface Props {
    item: ActivityItem | null;
    onClose: () => void;
    onRefresh?: () => Promise<boolean | void>;
}

function typeVisual(type: ActivityItemType): { icon: keyof typeof Ionicons.glyphMap; color: string } {
    switch (type) {
        case 'receive': return { icon: 'arrow-down', color: theme.colors.tx.receive };
        case 'send': return { icon: 'arrow-up', color: theme.colors.tx.sent };
        case 'swap': return { icon: 'swap-horizontal', color: theme.colors.tx.swap };
        case 'issuance': return { icon: 'add-circle-outline', color: theme.colors.accent[500] };
        case 'channel_open': return { icon: 'git-branch-outline', color: theme.colors.accent[500] };
        case 'channel_close': return { icon: 'close-circle-outline', color: theme.colors.warning[500] };
        default: return { icon: 'ellipse-outline', color: theme.colors.text.tertiary };
    }
}

function typeLabel(item: ActivityItem): string {
    if (item.crossChain) return item.crossChain.direction === 'deposit' ? 'Deposit from another chain' : 'Sent to another chain';
    if (item.kind === 'unilateral_exit') return 'Exit to Bitcoin';
    const onchainKind = item.source === 'onchain' ? rgbOnchainKindLabel(item.kind) : null;
    if (onchainKind) return onchainKind;
    switch (item.type) {
        case 'receive': return item.status === 'confirmed' ? 'Received' : 'Receive';
        case 'send': return item.status === 'confirmed' ? 'Sent' : 'Payment';
        case 'swap': return 'Atomic Swap';
        case 'issuance': return item.kind === 'Inflation' ? 'Inflation' : 'Issuance';
        case 'channel_open': return 'Channel Open';
        case 'channel_close': return 'Channel Close';
        default: return 'Transaction';
    }
}

function amountPrefix(type: ActivityItemType): string {
    if (type === 'receive' || type === 'issuance') return '+';
    if (type === 'send') return '−';
    return '';
}

/** What the fee paid for, by how the item moved. */
export function feeKind(item: Pick<ActivityItem, 'layer' | 'source' | 'swapAttemptId'>): { label: string; explanation: string } {
    if (item.swapAttemptId) return { label: 'Claim fee', explanation: 'Paid to Bitcoin miners to claim the swap’s on-chain payment.' };
    if (item.source === 'onchain' || item.layer === 'L1' || item.layer === 'RGB-L1') {
        return { label: 'Network fee', explanation: 'Paid to Bitcoin miners to include the transaction in a block. The recipient doesn’t get it.' };
    }
    if (item.layer === 'LN' || item.layer === 'RGB-LN') return { label: 'Routing fee', explanation: 'Paid to the Lightning nodes that forwarded the payment.' };
    return { label: `${LAYER_LABEL[item.layer] ?? item.layer} fee`, explanation: `Charged by ${LAYER_LABEL[item.layer] ?? item.layer} for this transfer.` };
}

/** A label/value row; values align right and long ones shrink rather than push the label off. */
function DetailRow({ label, children, styles, first }: { label: string; children: React.ReactNode; styles: ReturnType<typeof createStyles>; first?: boolean }) {
    return (
        <View style={[styles.row, !first && styles.rowDivider]}>
            <Text style={styles.rowLabel}>{label}</Text>
            <View style={styles.rowValueWrap}>{children}</View>
        </View>
    );
}

export const ActivityDetailSheet: React.FC<Props> = ({ item, onClose, onRefresh }) => {
    const theme = useAppTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const unit = useAppSelector(state => state.settings.bitcoinUnit);
    const btcPrice = useAppSelector(state => state.wallet?.btcPriceUSD ?? 0);
    const [checking, setChecking] = useState(false);
    const [checkMessage, setCheckMessage] = useState('');
    const [accelerating, setAccelerating] = useState(false);
    const [feeOpen, setFeeOpen] = useState(false);
    useEffect(() => { setAccelerating(false); setFeeOpen(false); }, [item?.id]);
    const [cancelling, setCancelling] = useState(false);
    const [cancelMessage, setCancelMessage] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
    // A cancel confirmed by the RGB account: shown at once, even before (or if) the list
    // reloads. A cancelled invoice leaves the list, so the item passed in may stay the old one.
    const [cancelledHere, setCancelledHere] = useState(false);
    useEffect(() => { setCancelling(false); setCancelMessage(null); setCancelledHere(false); }, [item?.id]);
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

    const v = typeVisual(item.type);
    const rgb = item.rgbTransfer;
    const status = cancelledHere ? 'failed' : item.status;
    const st = ACTIVITY_STATUS_VISUAL[status];
    const onchain = item.source === 'onchain' || item.layer === 'L1' || item.layer === 'RGB-L1';
    const statusLabel = onchain && status === 'pending' ? 'Awaiting confirmation' : onchain && status === 'confirmed' ? 'Confirmed on-chain' : st.label;
    const hasAmount = item.amount !== '';
    const isIncoming = item.type === 'receive' || item.type === 'issuance';
    const txLabel = item.crossChain ? 'Order ID' : item.paymentHash ? 'Payment hash' : 'Transaction ID';
    const cc = item.crossChain;
    // Spark's history id isn't the payment hash; the proof brings the real one.
    const proofHash = proof?.paymentHash ?? item.paymentHash;
    const proofVerified = !!proof && !!proofHash && preimageMatches(proof.preimage, proofHash);
    const target = accelerationTarget(item);
    const explorerUrl = activityExplorerUrl(item);
    const rgbAdapter = rgb ? rgbAccountAdapter() : null;
    const rgbSupport = rgbWalletSupport(rgbAdapter);
    const cancellable = !!rgb && !cancelledHere && canCancelRgbTransfer(rgb, rgbSupport);
    const removable = !!rgb && !cancelledHere && canDeleteRgbTransfer(rgb, rgbSupport);
    const rgbSettled = rgb?.status === 'settled';
    const invoice = rgb?.direction === 'incoming';
    const badgeLabel = cancelledHere ? 'Cancelled' : rgb && rgb.status !== 'settled' ? RGB_TRANSFER_STATUS_LABEL[rgb.status] : statusLabel;
    const statusDetail = cancelledHere
        ? (invoice ? 'This invoice is cancelled. Anything sent to it now won’t be received.' : 'This transfer is cancelled. The asset is free to send again.')
        : rgb ? (rgbSettled ? '' : rgbTransferStatusDetail(rgb.status, rgb.direction))
        : item.status === 'unknown' ? 'The provider has not confirmed the outcome. Check the status before sending again.'
        : item.status === 'pending' ? 'Submitted and waiting for confirmation. You can leave this screen and check again later.' : '';
    // Method, account and network in one line: "RGB · mutinynet", the account only when it says more.
    const accountName = item.account ?? (['LN', 'RGB-LN', 'RGB-L1', 'L1'].includes(item.layer) ? 'RGB' : item.layer);
    const methodText = [LAYER_LABEL[item.layer], accountName !== LAYER_LABEL[item.layer] && accountName !== item.layer ? accountName : null, item.network]
        .filter(Boolean).join(' · ');
    const assetId = item.asset && item.asset !== 'BTC' && !item.crossChain ? item.asset : '';
    const assetTitle = item.assetName && item.assetTicker && item.assetName !== item.assetTicker ? `${item.assetName} (${item.assetTicker})` : item.assetName || item.assetTicker;
    const amountText = item.rawSats != null ? `${formatBitcoinAmount(item.rawSats, unit)} ${unit}` : `${item.amount} ${item.assetTicker}`.trim();
    const fiat = item.rawSats != null && btcPrice > 0 ? `≈ $${formatSatoshisToUSD(item.rawSats, btcPrice)}` : '';
    const dateText = item.timestamp != null
        ? new Date(item.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
    const fee = item.fee != null ? feeKind(item) : null;
    // A send's total is what left the wallet: the amount plus the fee, both in sats.
    const totalSats = item.type === 'send' && item.rawSats != null && item.fee != null ? item.rawSats + item.fee : null;
    const busy = cancelling || checking;

    const refreshList = () => {
        forgetActivityInFlight('transfers');
        void onRefresh?.()?.catch?.(() => {});
    };

    const removeTransfer = () => {
        if (!rgb || rgb.batchTransferIdx == null) return;
        Alert.alert(
            'Remove from history?',
            'This failed transfer moved nothing. Removing it only tidies your history.',
            [
                { text: 'Keep', style: 'cancel' },
                {
                    text: 'Remove', style: 'destructive', onPress: async () => {
                        setCancelling(true); setCancelMessage(null);
                        try {
                            const removed = await deleteRgbTransfer(rgbAdapter, rgb.batchTransferIdx!);
                            if (!removed) { setCancelMessage({ tone: 'warning', text: 'This transfer can’t be removed.' }); return; }
                            refreshList();
                            onClose();
                        } catch (e) {
                            setCancelMessage({ tone: 'error', text: rgbWalletErrorMessage(e, 'delete') });
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
            invoice ? 'Cancel this invoice?' : 'Cancel this transfer?',
            invoice
                ? 'Anything sent to it afterwards won’t be received. Make a new invoice if you still want the asset.'
                : 'The recipient hasn’t accepted it yet. Cancelling frees the asset to send again.',
            [
                { text: 'Keep', style: 'cancel' },
                {
                    text: invoice ? 'Cancel invoice' : 'Cancel transfer', style: 'destructive', onPress: async () => {
                        setCancelling(true); setCancelMessage(null);
                        try {
                            const failed = await cancelRgbTransfer(rgbAdapter, rgb.batchTransferIdx!);
                            if (failed) {
                                setCancelledHere(true);
                                setCancelMessage({ tone: 'success', text: invoice ? 'Invoice cancelled.' : 'Transfer cancelled.' });
                            } else {
                                setCancelMessage({ tone: 'warning', text: 'This transfer can no longer be cancelled: it has already moved on. Its status is being refreshed.' });
                            }
                            // The list reloads in the background; the sheet already shows the outcome.
                            refreshList();
                        } catch (e) {
                            setCancelMessage({ tone: 'error', text: rgbWalletErrorMessage(e, 'cancel') });
                        } finally {
                            setCancelling(false);
                        }
                    },
                },
            ],
        );
    };
    const share = () => {
        void Share.share({
            message: [
                `${typeLabel(item)} · ${badgeLabel}`,
                hasAmount ? `Amount ${amountPrefix(item.type)}${amountText}` : '',
                fee && item.fee != null ? `${fee.label} ${formatBitcoinAmount(item.fee, unit)} ${unit}` : '',
                dateText ? `Date ${dateText}` : '',
                `Network ${methodText}`,
                item.contactName ? `${isIncoming ? 'From' : 'To'} ${item.contactName}` : '',
                item.txid ? `${txLabel} ${item.txid}` : '',
                explorerUrl ?? '',
            ].filter(Boolean).join('\n'),
        }).catch(() => {});
    };
    const checkStatus = async () => {
        if (!onRefresh) return;
        setChecking(true); setCheckMessage('');
        try { const refreshed = await onRefresh(); setCheckMessage(refreshed === false ? 'Some accounts could not be checked. Try again when connected.' : 'Latest available activity checked.'); }
        catch { setCheckMessage('Could not check the status. Try again.'); }
        finally { setChecking(false); }
    };

    const rows: { key: string; label: string; value: React.ReactNode }[] = [];
    if (dateText) rows.push({ key: 'date', label: 'Date', value: <Text style={styles.rowValue}>{dateText}</Text> });
    rows.push({ key: 'network', label: 'Network', value: <View style={styles.layerChip}>
        {layerNetworkIcon(item.layer) && <NetworkIcon network={layerNetworkIcon(item.layer)!} size={14} />}
        <Text style={styles.layerChipText} numberOfLines={1}>{methodText}</Text>
    </View> });
    if (item.contactName) rows.push({ key: 'contact', label: isIncoming ? 'From' : 'Recipient', value: <Text style={styles.rowValue} numberOfLines={1}>{item.contactName}</Text> });
    if (assetId || item.assetName) rows.push({ key: 'asset', label: 'Asset', value: <Text style={styles.rowValue} numberOfLines={1}>{assetTitle}</Text> });
    if (assetId) rows.push({ key: 'asset-id', label: 'Asset ID', value: <>
        <Text style={styles.monoValue} selectable numberOfLines={1}>{middleEllipsis(assetId, 12, 8)}</Text>
        <CopyButton value={assetId} size={14} />
    </> });
    if (cc) {
        rows.push({ key: 'route', label: 'Route', value: <View style={styles.routeChip}>
            <NetworkIcon network={cc.sourceChain} size={14} />
            <Text style={styles.layerChipText}>{cc.sourceAsset} on {chainLabel(cc.sourceChain)}</Text>
            <Ionicons name="arrow-forward" size={12} color={theme.colors.text.tertiary} />
            <NetworkIcon network={cc.destChain} size={14} />
            <Text style={styles.layerChipText}>{cc.destAsset} on {chainLabel(cc.destChain)}</Text>
        </View> });
        if (cc.amountOutRaw) rows.push({ key: 'out', label: cc.direction === 'deposit' ? 'You receive' : 'They receive', value: <AmountText style={styles.rowValue}>
            {cc.status === 'completed' ? '' : '≈ '}{formatRecordAmount(cc.amountOutRaw, cc.destDecimals, cc.destAsset)}
        </AmountText> });
        if (cc.recipient) rows.push({ key: 'cc-recipient', label: 'Recipient', value: <>
            <Text style={styles.monoValue} selectable numberOfLines={1}>{middleEllipsis(cc.recipient, 8, 6)}</Text>
            <CopyButton value={cc.recipient} size={14} />
        </> });
    }
    if (item.txid) rows.push({ key: 'txid', label: txLabel, value: <>
        <Text style={styles.monoValue} selectable numberOfLines={1}>{middleEllipsis(item.txid, 8, 8)}</Text>
        <CopyButton value={item.txid} size={14} />
    </> });

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
                ) : (
                <ScrollView contentContainerStyle={styles.body}>
                    {/* Hero: direction, amount, fiat, status. */}
                    <View style={styles.header}>
                        <View style={[styles.bigIcon, { backgroundColor: v.color + '1A' }]}>
                            <Ionicons name={v.icon} size={26} color={v.color} />
                        </View>
                        <Text style={styles.typeLabel}>{typeLabel(item)}</Text>
                        {hasAmount && (
                            <AmountText
                                accessibilityLabel={`Amount ${status === 'failed' ? '' : amountPrefix(item.type)}${amountText}`}
                                style={[styles.amount, { color: isIncoming ? theme.colors.tx.receive : theme.colors.text.primary }, status === 'failed' && styles.amountFailed]}
                            >
                                {status === 'failed' ? '' : amountPrefix(item.type)}{amountText}
                            </AmountText>
                        )}
                        {!!fiat && <AmountText style={styles.fiat}>{fiat}</AmountText>}
                        {/* Status: an RGB transfer's own step reads better than "Confirmed on-chain" + "Settled". */}
                        <View style={styles.headerStatus}>
                            <Badge label={badgeLabel} color={st.color} size="md" />
                            <ExplainButton compact subject={rgb ? { type: 'rgb-transfer', item } : { type: 'activity', item }} />
                        </View>
                        {!!statusDetail && <Text style={styles.statusDetail}>{statusDetail}</Text>}
                    </View>

                    {!!cancelMessage && (
                        <View accessibilityLiveRegion="polite"><Callout tone={cancelMessage.tone} message={cancelMessage.text} /></View>
                    )}

                    <Text style={styles.sectionTitle}>Details</Text>
                    <View style={styles.card}>
                        {rows.map((row, i) => <DetailRow key={row.key} label={row.label} styles={styles} first={i === 0}>{row.value}</DetailRow>)}
                    </View>
                    {cc?.status === 'unpaid' && (
                        <Text style={styles.note}>The payment from Spark wasn't confirmed. Open Send to check this transfer before sending again.</Text>
                    )}

                    {fee && item.fee != null && (
                        <>
                            <Text style={styles.sectionTitle}>Fees</Text>
                            <View style={styles.card}>
                                <DetailRow label={fee.label} styles={styles} first>
                                    <AmountText style={styles.rowValue}>{`${formatBitcoinAmount(item.fee, unit)} ${unit}`}</AmountText>
                                </DetailRow>
                                {totalSats != null && (
                                    <DetailRow label="Total sent" styles={styles}>
                                        <AmountText style={[styles.rowValue, styles.rowValueStrong]}>{`${formatBitcoinAmount(totalSats, unit)} ${unit}`}</AmountText>
                                    </DetailRow>
                                )}
                                <TouchableOpacity
                                    accessibilityRole="button"
                                    accessibilityState={{ expanded: feeOpen }}
                                    accessibilityLabel={feeOpen ? 'Hide fee explanation' : 'What is this fee?'}
                                    onPress={() => setFeeOpen(o => !o)}
                                    style={[styles.row, styles.rowDivider]}
                                >
                                    <Text style={styles.linkText}>What is this fee?</Text>
                                    <Ionicons name={feeOpen ? 'chevron-up' : 'chevron-down'} size={16} color={theme.colors.text.tertiary} />
                                </TouchableOpacity>
                                {feeOpen && (
                                    <View style={styles.feeExplain}>
                                        <Text style={styles.note}>{fee.explanation}</Text>
                                        <ExplainButton compact subject={{ type: 'fee', item }} />
                                    </View>
                                )}
                            </View>
                        </>
                    )}

                    {proof && (
                        <>
                            <Text style={styles.sectionTitle}>Proof of payment</Text>
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
                                        <View style={styles.txidHeader}>
                                            <Text style={styles.rowLabel}>Payment hash</Text>
                                            <CopyButton value={proofHash} label="Copy" size={14} />
                                        </View>
                                        <Text style={styles.txidText} selectable numberOfLines={3}>{proofHash}</Text>
                                    </>
                                )}
                            </View>
                        </>
                    )}

                    {/* Actions: the ones that change something first, then the read-only ones. */}
                    <View style={styles.actions}>
                        {cancellable && (
                            <Button
                                title={cancelling ? 'Cancelling…' : invoice ? 'Cancel invoice' : 'Cancel transfer'}
                                variant="secondary"
                                onPress={cancelTransfer}
                                disabled={busy}
                                textStyle={{ color: theme.colors.error[500] }}
                                fullWidth
                            />
                        )}
                        {removable && (
                            <Button
                                title={cancelling ? 'Removing…' : 'Remove from history'}
                                variant="ghost"
                                onPress={removeTransfer}
                                disabled={busy}
                                textStyle={{ color: theme.colors.error[500] }}
                                fullWidth
                            />
                        )}
                        {target && (
                            <Button
                                title="Accelerate"
                                variant="secondary"
                                onPress={() => setAccelerating(true)}
                                icon={<Ionicons name="rocket-outline" size={18} color={theme.colors.primary[500]} />}
                                fullWidth
                            />
                        )}
                        {onRefresh && (
                            <Button title={checking ? 'Checking…' : 'Check status'} variant="secondary" onPress={() => void checkStatus()} disabled={busy} fullWidth />
                        )}
                        {!!checkMessage && <Text accessibilityLiveRegion="polite" style={styles.note}>{checkMessage}</Text>}
                        <View style={styles.actionRow}>
                            <Button title="Share" variant="ghost" onPress={share} style={styles.actionHalf}
                                icon={<Ionicons name="share-outline" size={16} color={theme.colors.text.primary} />} />
                            {explorerUrl && (
                                <Button title="View in explorer" variant="ghost" onPress={() => { Linking.openURL(explorerUrl).catch(() => {}); }} style={styles.actionHalf}
                                    icon={<Ionicons name="open-outline" size={16} color={theme.colors.text.primary} />} />
                            )}
                        </View>
                    </View>
                </ScrollView>
                )}

                <View style={styles.footer}>
                    <Button title="Close" variant="secondary" onPress={onClose} fullWidth />
                </View>
            </View>
        </Modal>
    );
};

const createStyles = (theme: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.primary,
        paddingBottom: Platform.OS === 'ios' ? theme.spacing[8] : theme.spacing[6],
    },
    handle: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: theme.borderRadius.full,
        backgroundColor: theme.colors.border.medium,
        marginTop: theme.spacing[3],
        marginBottom: theme.spacing[2],
    },
    body: {
        paddingHorizontal: theme.spacing[4],
        paddingTop: theme.spacing[2],
        gap: theme.spacing[2],
        paddingBottom: theme.spacing[4],
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
        borderRadius: theme.borderRadius.full,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing[1],
    },
    typeLabel: {
        fontSize: theme.typography.fontSize.base,
        lineHeight: leading(theme.typography.fontSize.base),
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.secondary,
    },
    amount: {
        fontSize: theme.typography.fontSize['3xl'],
        lineHeight: leading(theme.typography.fontSize['3xl'], theme.typography.lineHeight.tight),
        fontWeight: theme.typography.fontWeight.bold,
        textAlign: 'center',
    },
    amountFailed: {
        color: theme.colors.text.tertiary,
        textDecorationLine: 'line-through',
    },
    fiat: {
        fontSize: theme.typography.fontSize.sm,
        lineHeight: leading(theme.typography.fontSize.sm),
        color: theme.colors.text.tertiary,
    },
    headerStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
        marginTop: theme.spacing[1],
    },
    statusDetail: {
        fontSize: theme.typography.fontSize.sm,
        lineHeight: leading(theme.typography.fontSize.sm),
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
    sectionTitle: {
        fontSize: theme.typography.fontSize.xs,
        lineHeight: leading(theme.typography.fontSize.xs),
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.tertiary,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginTop: theme.spacing[2],
        marginLeft: theme.spacing[1],
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
        minHeight: 44,
        paddingVertical: theme.spacing[2],
    },
    rowDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.light,
    },
    rowLabel: {
        fontSize: theme.typography.fontSize.sm,
        lineHeight: leading(theme.typography.fontSize.sm),
        color: theme.colors.text.secondary,
    },
    rowValueWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[2],
        flexShrink: 1,
        justifyContent: 'flex-end',
    },
    rowValue: {
        fontSize: theme.typography.fontSize.sm,
        lineHeight: leading(theme.typography.fontSize.sm),
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.primary,
        flexShrink: 1,
        textAlign: 'right',
    },
    rowValueStrong: {
        fontWeight: theme.typography.fontWeight.bold,
    },
    monoValue: {
        fontSize: theme.typography.fontSize.xs,
        lineHeight: leading(theme.typography.fontSize.xs),
        fontFamily: theme.typography.fontFamily.mono,
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    layerChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[1],
        paddingHorizontal: theme.spacing[2],
        paddingVertical: theme.spacing[0.5],
        borderRadius: theme.borderRadius.sm,
        backgroundColor: theme.colors.surface.tertiary,
        flexShrink: 1,
    },
    routeChip: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        gap: theme.spacing[1],
        flexShrink: 1,
    },
    layerChipText: {
        fontSize: theme.typography.fontSize.xs,
        lineHeight: leading(theme.typography.fontSize.xs),
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.text.secondary,
    },
    linkText: {
        fontSize: theme.typography.fontSize.sm,
        lineHeight: leading(theme.typography.fontSize.sm),
        fontWeight: theme.typography.fontWeight.semibold,
        color: theme.colors.primary[500],
    },
    feeExplain: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.spacing[2],
        paddingBottom: theme.spacing[3],
    },
    note: {
        flex: 1,
        fontSize: theme.typography.fontSize.xs,
        lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.relaxed),
        color: theme.colors.text.tertiary,
    },
    proofRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing[1.5],
    },
    proofText: {
        fontSize: theme.typography.fontSize.xs,
        lineHeight: leading(theme.typography.fontSize.xs),
        color: theme.colors.success[500],
        fontWeight: theme.typography.fontWeight.semibold,
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
    },
    txidText: {
        fontSize: theme.typography.fontSize.xs,
        fontFamily: theme.typography.fontFamily.mono,
        color: theme.colors.text.secondary,
        lineHeight: leading(theme.typography.fontSize.xs, theme.typography.lineHeight.relaxed),
    },
    actions: {
        gap: theme.spacing[2],
        marginTop: theme.spacing[3],
    },
    actionRow: {
        flexDirection: 'row',
        gap: theme.spacing[2],
    },
    actionHalf: {
        flex: 1,
    },
    footer: {
        paddingHorizontal: theme.spacing[4],
        paddingTop: theme.spacing[2],
    },
});

export default ActivityDetailSheet;
