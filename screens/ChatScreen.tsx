// screens/ChatScreen.tsx
//
// One-to-one encrypted chat with a contact over Nostr. Messages are NIP-17
// gift-wrapped by default (the most private option); the user can switch to
// NIP-44 or legacy NIP-04 from the header, with each option explained. The chat
// also carries payments: "Request" sends a structured payment request (see
// docs/nip-payment-requests.md) rendered as an actionable, stateful card, and an
// invoice in a message can be paid in-place.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  Clipboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RootState } from '../store';
import {
  loadConversation,
  sendDirectMessage,
  sendPaymentRequest,
  sendPaymentReceipt,
  receiveMessage,
  setSendScheme,
  setActiveConversation,
  markRead,
  markPaid,
} from '../store/slices/chatSlice';
import NostrService, { DirectMessage, DMScheme, ChatPaymentRequest } from '../services/NostrService';
import { createChatInvoice, payChatInvoice } from '../services/chatPayments';
import ToastService from '../services/ToastService';
import { findPayable, stripPayable, Payable } from '../utils/decodeInvoice';
import { PayableCard } from '../components/chat/PayableCard';
import PaymentConfirmationModal from '../components/PaymentConfirmationModal';
import { theme } from '../theme';

interface Props {
  navigation: any;
  route: any;
}

interface PaymentDetails {
  type: 'lightning_address' | 'lightning_invoice' | 'nostr_contact';
  recipient: string;
  amount: number;
  description?: string;
  recipientName?: string;
  recipientAvatar?: string;
  lightningAddress?: string;
  isNostrContact?: boolean;
  priceUsd?: number;
}

type PendingPay =
  | { kind: 'invoice'; raw: string; amountSats?: number; requestId?: string; details: PaymentDetails }
  | { kind: 'address'; address: string; amountSats: number; note?: string; details: PaymentDetails };

// User-facing explanation of each encryption scheme, most private first.
const SCHEMES: {
  key: DMScheme;
  name: string;
  tagline: string;
  desc: string;
  badge: string;
  recommended?: boolean;
}[] = [
  {
    key: 'nip17',
    name: 'Private',
    tagline: 'NIP-17 · gift-wrapped',
    desc: 'Each message is sealed and wrapped under a one-time key. Hides who you talk to, when, and what you say. Most private.',
    badge: 'Most secure',
    recommended: true,
  },
  {
    key: 'nip44',
    name: 'Encrypted',
    tagline: 'NIP-44 · modern',
    desc: 'Strong ChaCha20 encryption of the message body, but the sender, recipient and timing are visible to relays.',
    badge: 'Secure',
  },
  {
    key: 'nip04',
    name: 'Legacy',
    tagline: 'NIP-04 · compatible',
    desc: 'The original DM format (AES-CBC). Works with the oldest clients but is weaker and leaks metadata.',
    badge: 'Legacy',
  },
];

export default function ChatScreen({ navigation, route }: Props) {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const { pubkey, name, avatarUrl } = (route?.params ?? {}) as {
    pubkey: string;
    name?: string;
    npub?: string;
    avatarUrl?: string;
  };

  const isConnected = useSelector((s: RootState) => s.nostr.isConnected);
  const sendScheme = useSelector((s: RootState) => s.chat.sendScheme);
  const messages = useSelector(
    (s: RootState) => s.chat.conversations?.[pubkey] ?? [],
  ) as DirectMessage[];
  const isLoading = useSelector((s: RootState) => !!s.chat.loadingByPubkey?.[pubkey]);
  const paidInvoices = useSelector((s: RootState) => s.chat.paidInvoices) || {};
  const rgbAssets = useSelector((s: RootState) => s.assets.rgbAssets);
  const btcPriceUSD = useSelector((s: RootState) => s.wallet.btcPriceUSD);
  const contactLud16 = useSelector(
    (s: RootState) => s.nostr.contacts.find((c) => c.pubkey === pubkey)?.profile?.lud16,
  );

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showScheme, setShowScheme] = useState(false);

  const [showRequest, setShowRequest] = useState(false);
  const [reqAssetId, setReqAssetId] = useState<string | null>(null);
  const [reqAmount, setReqAmount] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqBusy, setReqBusy] = useState(false);

  const [showSend, setShowSend] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendNote, setSendNote] = useState('');

  const [pending, setPending] = useState<PendingPay | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  const listRef = useRef<FlatList<DirectMessage>>(null);

  const contactName = name || 'Chat';
  const scheme = SCHEMES.find((s) => s.key === sendScheme) ?? SCHEMES[0];

  const assetOptions = useMemo(
    () => [
      { id: null as string | null, ticker: 'BTC', unit: 'sats', precision: 0 },
      ...rgbAssets.map((a) => ({ id: a.asset_id, ticker: a.ticker, unit: a.ticker, precision: a.precision })),
    ],
    [rgbAssets],
  );
  const reqAsset = assetOptions.find((o) => o.id === reqAssetId) ?? assetOptions[0];

  // Request ids that have been settled (a paid receipt exists in this thread).
  const paidRequestIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (m.receipt?.status === 'paid' && m.receipt.requestId) set.add(m.receipt.requestId);
    }
    return set;
  }, [messages]);

  useFocusEffect(
    useCallback(() => {
      if (pubkey) {
        dispatch(setActiveConversation(pubkey));
        dispatch(markRead(pubkey));
      }
      return () => {
        dispatch(setActiveConversation(null));
      };
    }, [pubkey, dispatch]),
  );

  useEffect(() => {
    if (!isConnected || !pubkey) return;
    dispatch(loadConversation(pubkey) as any);

    let subId: string | null = null;
    try {
      subId = NostrService.getInstance().subscribeToConversation(pubkey, (message) => {
        dispatch(receiveMessage({ pubkey, message }));
      });
    } catch (e) {
      console.warn('ChatScreen: failed to subscribe', e);
    }

    return () => {
      if (subId) NostrService.getInstance().unsubscribe(subId);
    };
  }, [isConnected, pubkey, dispatch]);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  const copyToClipboard = useCallback((text: string, label = 'Invoice') => {
    Clipboard.setString(text);
    ToastService.getInstance().copied(label);
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;
    if (!isConnected) {
      Alert.alert('Not connected', 'Connect Nostr in Settings to send messages.');
      return;
    }
    setIsSending(true);
    try {
      await dispatch(sendDirectMessage({ pubkey, text }) as any).unwrap();
      setDraft('');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Failed to send the message.');
    } finally {
      setIsSending(false);
    }
  }, [draft, isSending, isConnected, pubkey, dispatch]);

  // ── Request payment ────────────────────────────────────────────────────────
  const openRequest = () => {
    setShowActions(false);
    setReqAssetId(null);
    setReqAmount('');
    setReqNote('');
    setShowRequest(true);
  };

  const handleCreateRequest = async () => {
    const amt = parseFloat(reqAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Enter an amount', 'Please enter an amount greater than zero.');
      return;
    }
    setReqBusy(true);
    try {
      const { invoice } = await createChatInvoice({
        assetId: reqAsset.id ?? undefined,
        amount: amt,
        precision: reqAsset.precision,
        description: reqNote || undefined,
      });
      const requestId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const req: ChatPaymentRequest = {
        invoice,
        requestId,
        description: reqNote || undefined,
        ...(reqAsset.id
          ? { asset: { id: reqAsset.id, ticker: reqAsset.ticker, precision: reqAsset.precision, amount: amt } }
          : { amountMsat: Math.round(amt) * 1000 }),
      };
      await dispatch(sendPaymentRequest({ pubkey, req }) as any).unwrap();
      setShowRequest(false);
    } catch (e: any) {
      Alert.alert('Could not create request', e?.message || 'Failed to create the invoice.');
    } finally {
      setReqBusy(false);
    }
  };

  // ── Pay ─────────────────────────────────────────────────────────────────────
  const payInvoiceFromBubble = (raw: string, amountSats?: number, requestId?: string) => {
    setPending({
      kind: 'invoice',
      raw,
      amountSats,
      requestId,
      details: {
        type: 'lightning_invoice',
        recipient: raw,
        amount: amountSats ?? 0,
        recipientName: contactName,
        recipientAvatar: avatarUrl,
        isNostrContact: true,
        priceUsd: btcPriceUSD || undefined,
      },
    });
  };

  const openSend = () => {
    setShowActions(false);
    if (!contactLud16) {
      Alert.alert(
        'No Lightning address',
        'This contact has no Lightning address on their Nostr profile. Ask them to send a payment request, then tap Pay.',
      );
      return;
    }
    setSendAmount('');
    setSendNote('');
    setShowSend(true);
  };

  const handleConfirmSendAmount = () => {
    const amt = parseInt(sendAmount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Enter an amount', 'Please enter an amount greater than zero.');
      return;
    }
    setShowSend(false);
    setPending({
      kind: 'address',
      address: contactLud16!,
      amountSats: amt,
      note: sendNote || undefined,
      details: {
        type: 'lightning_address',
        recipient: contactLud16!,
        amount: amt,
        description: sendNote || undefined,
        recipientName: contactName,
        recipientAvatar: avatarUrl,
        lightningAddress: contactLud16!,
        isNostrContact: true,
        priceUsd: btcPriceUSD || undefined,
      },
    });
  };

  const confirmPay = async () => {
    if (!pending) return;
    setPayLoading(true);
    try {
      if (pending.kind === 'invoice') {
        const result = await payChatInvoice(pending.raw);
        dispatch(markPaid(pending.raw));
        ToastService.getInstance().success('Payment sent');
        const preimage = result?.preimage || result?.paymentPreimage;
        if (pending.requestId) {
          // Structured request → reply with a correlated receipt.
          dispatch(
            sendPaymentReceipt({
              pubkey,
              receipt: { requestId: pending.requestId, status: 'paid', preimage },
            }) as any,
          ).catch(() => {});
        } else {
          sendReceipt(pending.amountSats, false);
        }
      } else {
        const res = await NostrService.getInstance().requestLnurlPayInvoice({
          lightningAddress: pending.address,
          amountSats: pending.amountSats,
          comment: pending.note,
        });
        if ('error' in res) throw new Error(res.error);
        await payChatInvoice(res.invoice);
        ToastService.getInstance().success('Payment sent');
        sendReceipt(pending.amountSats, true);
      }
      setPending(null);
    } catch (e: any) {
      Alert.alert('Payment failed', e?.message || 'Could not complete the payment.');
    } finally {
      setPayLoading(false);
    }
  };

  const sendReceipt = (amountSats?: number, sent = false) => {
    const verb = sent ? 'Sent' : 'Paid';
    const text = amountSats ? `⚡ ${verb} ${amountSats.toLocaleString()} sats` : `⚡ ${verb}`;
    dispatch(sendDirectMessage({ pubkey, text }) as any).catch(() => {});
  };

  const pickScheme = (key: DMScheme) => {
    dispatch(setSendScheme(key));
    setShowScheme(false);
  };

  // ── Renderers ───────────────────────────────────────────────────────────────
  const renderPaymentRequest = (item: DirectMessage) => {
    const p = item.payment!;
    const amountLabel =
      p.asset?.amount != null
        ? `${p.asset.amount} ${p.asset.ticker || 'asset'}`
        : p.amountMsat
          ? `${Math.round(p.amountMsat / 1000).toLocaleString()} sats`
          : 'Any amount';
    const expired = p.expiry ? Date.now() / 1000 > p.expiry : false;
    const paid = !!paidInvoices[p.invoice] || (p.requestId ? paidRequestIds.has(p.requestId) : false);
    const amountSats = p.amountMsat ? Math.round(p.amountMsat / 1000) : undefined;

    return (
      <View style={styles.reqCard}>
        <View style={styles.reqHead}>
          <View style={styles.reqIcon}>
            <Ionicons name="cash-outline" size={16} color={theme.colors.primary[500]} />
          </View>
          <Text style={styles.reqHeadText}>Payment request</Text>
        </View>
        <Text style={styles.reqAmount}>{amountLabel}</Text>
        {!!p.description && <Text style={styles.reqDesc}>{p.description}</Text>}

        {paid ? (
          <View style={styles.reqStatus}>
            <Ionicons name="checkmark-circle" size={16} color={theme.colors.success[500]} />
            <Text style={[styles.reqStatusText, { color: theme.colors.success[500] }]}>Paid</Text>
          </View>
        ) : expired ? (
          <View style={styles.reqStatus}>
            <Ionicons name="time-outline" size={15} color={theme.colors.text.tertiary} />
            <Text style={styles.reqStatusText}>Expired</Text>
          </View>
        ) : item.mine ? (
          <View style={styles.reqStatus}>
            <Ionicons name="hourglass-outline" size={14} color={theme.colors.text.tertiary} />
            <Text style={styles.reqStatusText}>Awaiting payment</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.payBtn}
            onPress={() => payInvoiceFromBubble(p.invoice, amountSats, p.requestId)}
            activeOpacity={0.85}
          >
            <Ionicons name="flash" size={15} color={theme.colors.text.inverse} />
            <Text style={styles.payBtnText}>Pay {amountLabel}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.reqCopy} onPress={() => copyToClipboard(p.invoice, 'Invoice')} hitSlop={8}>
          <Ionicons name="copy-outline" size={13} color={theme.colors.text.tertiary} />
          <Text style={styles.reqCopyText}>Copy invoice</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderItem = ({ item, index }: { item: DirectMessage; index: number }) => {
    const prev = index > 0 ? messages[index - 1] : null;
    const showDay = !prev || dayKey(prev.createdAt) !== dayKey(item.createdAt);

    // Receipts render as a slim centered status line.
    if (item.receipt) {
      const label =
        item.receipt.status === 'paid'
          ? `${item.mine ? 'You' : contactName} paid`
          : item.receipt.status === 'declined'
            ? `${item.mine ? 'You' : contactName} declined`
            : 'Request expired';
      return (
        <>
          {showDay && <DaySeparator createdAt={item.createdAt} />}
          <View style={styles.receiptRow}>
            <Ionicons
              name={item.receipt.status === 'paid' ? 'checkmark-circle' : 'close-circle'}
              size={13}
              color={item.receipt.status === 'paid' ? theme.colors.success[500] : theme.colors.text.tertiary}
            />
            <Text style={styles.receiptText}>{label}</Text>
          </View>
        </>
      );
    }

    const legacyPayable: Payable | null = item.payment ? null : findPayable(item.content);
    const note = legacyPayable ? stripPayable(item.content, legacyPayable) : '';
    const isPaidLegacy = legacyPayable ? !!paidInvoices[legacyPayable.raw] : false;
    const legacyPayableInChat = legacyPayable?.kind === 'bolt11';

    return (
      <>
        {showDay && <DaySeparator createdAt={item.createdAt} />}
        <View style={[styles.row, item.mine ? styles.rowMine : styles.rowTheirs]}>
          <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {item.payment ? (
              renderPaymentRequest(item)
            ) : legacyPayable ? (
              <>
                {!!note && <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>{note}</Text>}
                <PayableCard payable={legacyPayable} onCopy={copyToClipboard} />
                {item.mine ? (
                  <View style={styles.payRow}>
                    <Ionicons name="hourglass-outline" size={13} color={mineMuted(item.mine)} />
                    <Text style={[styles.payHint, { color: mineMuted(item.mine) }]}>
                      {isPaidLegacy ? 'Paid' : 'Awaiting payment'}
                    </Text>
                  </View>
                ) : isPaidLegacy ? (
                  <View style={styles.payRow}>
                    <Ionicons name="checkmark-circle" size={15} color={theme.colors.success[500]} />
                    <Text style={[styles.payHint, { color: theme.colors.success[500] }]}>Paid</Text>
                  </View>
                ) : legacyPayableInChat ? (
                  <TouchableOpacity
                    style={styles.payBtn}
                    onPress={() => payInvoiceFromBubble(legacyPayable.raw, legacyPayable.amountSats)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="flash" size={15} color={theme.colors.text.inverse} />
                    <Text style={styles.payBtnText}>
                      Pay{legacyPayable.amountSats ? ` ${legacyPayable.amountSats.toLocaleString()} sats` : ''}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.payBtn, styles.payBtnAlt]}
                    onPress={() => navigation.navigate('Send', { address: legacyPayable.raw })}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="open-outline" size={15} color={theme.colors.primary[500]} />
                    <Text style={[styles.payBtnText, { color: theme.colors.primary[500] }]}>Open in Send</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>{item.content}</Text>
            )}
            <View style={styles.metaRow}>
              <Text style={[styles.time, item.mine && styles.timeMine]}>{formatTime(item.createdAt)}</Text>
              {(item.scheme === 'nip17' || item.scheme === 'nip44') && (
                <Ionicons
                  name="shield-checkmark"
                  size={10}
                  color={item.mine ? 'rgba(255,255,255,0.85)' : theme.colors.text.tertiary}
                />
              )}
            </View>
          </View>
        </View>
      </>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header with avatar + encryption picker */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={theme.colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.headerAvatarImg} />
          ) : (
            <Text style={styles.headerAvatarInitial}>{contactName.charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={styles.headerTitleArea}>
          <Text style={styles.headerName} numberOfLines={1}>{contactName}</Text>
          <View style={styles.headerSubRow}>
            <Ionicons name="lock-closed" size={10} color={theme.colors.success[500]} />
            <Text style={styles.headerSub} numberOfLines={1}>End-to-end encrypted</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.schemeBtn}
          onPress={() => setShowScheme(true)}
          activeOpacity={0.8}
          accessibilityLabel={`Encryption: ${scheme.name}. Tap to change.`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="shield-checkmark" size={13} color={theme.colors.primary[500]} />
          <Text style={styles.schemeBtnText}>{scheme.name}</Text>
        </TouchableOpacity>
      </View>

      {!isConnected ? (
        <View style={styles.center}>
          <Ionicons name="planet-outline" size={44} color={theme.colors.text.tertiary} />
          <Text style={styles.centerTitle}>Nostr not connected</Text>
          <Text style={styles.centerDesc}>
            Connect Nostr in Settings to send and receive encrypted messages.
          </Text>
          <TouchableOpacity style={styles.connectBtn} onPress={() => navigation.navigate('Settings')}>
            <Text style={styles.connectBtnText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              isLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator color={theme.colors.primary[500]} />
                </View>
              ) : (
                <View style={styles.center}>
                  <Ionicons name="chatbubbles-outline" size={44} color={theme.colors.text.tertiary} />
                  <Text style={styles.centerTitle}>No messages yet</Text>
                  <Text style={styles.centerDesc}>
                    Say hello or request a payment — everything is encrypted end-to-end.
                  </Text>
                </View>
              )
            }
          />

          <View style={styles.inputBar}>
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={() => setShowActions(true)}
              activeOpacity={0.85}
              accessibilityLabel="Payment actions"
            >
              <Ionicons name="flash" size={20} color={theme.colors.primary[500]} />
            </TouchableOpacity>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Encrypted message…"
              placeholderTextColor={theme.colors.text.tertiary}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || isSending) && styles.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || isSending}
              activeOpacity={0.85}
            >
              {isSending ? (
                <ActivityIndicator size="small" color={theme.colors.text.inverse} />
              ) : (
                <Ionicons name="send" size={18} color={theme.colors.text.inverse} />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Encryption scheme picker */}
      <Modal visible={showScheme} transparent animationType="slide" onRequestClose={() => setShowScheme(false)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowScheme(false)} />
          <View style={styles.formSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.formTitle}>Message encryption</Text>
            <Text style={styles.sheetDesc}>Choose how your messages are protected. This applies to new messages.</Text>
            {SCHEMES.map((s) => {
              const active = s.key === sendScheme;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.schemeRow, active && styles.schemeRowActive]}
                  onPress={() => pickScheme(s.key)}
                  activeOpacity={0.85}
                >
                  <View style={styles.flex}>
                    <View style={styles.schemeRowHead}>
                      <Text style={styles.schemeName}>{s.name}</Text>
                      <View style={[styles.schemeBadge, s.recommended && styles.schemeBadgeRec]}>
                        <Text style={[styles.schemeBadgeText, s.recommended && styles.schemeBadgeTextRec]}>{s.badge}</Text>
                      </View>
                      {s.recommended && <Ionicons name="star" size={12} color={theme.colors.warning[500]} />}
                    </View>
                    <Text style={styles.schemeTagline}>{s.tagline}</Text>
                    <Text style={styles.schemeDesc}>{s.desc}</Text>
                  </View>
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={active ? theme.colors.primary[500] : theme.colors.text.tertiary}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Payment action sheet */}
      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setShowActions(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity style={styles.sheetItem} onPress={openRequest} activeOpacity={0.8}>
              <View style={styles.sheetIcon}>
                <Ionicons name="download-outline" size={22} color={theme.colors.primary[500]} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.sheetTitle}>Request payment</Text>
                <Text style={styles.sheetDesc}>Create an invoice and send it in chat</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetItem} onPress={openSend} activeOpacity={0.8}>
              <View style={styles.sheetIcon}>
                <Ionicons name="paper-plane-outline" size={20} color={theme.colors.primary[500]} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.sheetTitle}>Send payment</Text>
                <Text style={styles.sheetDesc}>
                  {contactLud16 ? `Pay ${contactName} via Lightning` : 'Needs their Lightning address'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Request payment sheet */}
      <Modal visible={showRequest} transparent animationType="slide" onRequestClose={() => !reqBusy && setShowRequest(false)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !reqBusy && setShowRequest(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.formTitle}>Request payment</Text>

              <Text style={styles.fieldLabel}>Asset</Text>
              <View style={styles.chipsRow}>
                {assetOptions.map((opt) => {
                  const active = opt.id === reqAssetId;
                  return (
                    <TouchableOpacity
                      key={opt.id ?? 'btc'}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setReqAssetId(opt.id)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.ticker}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Amount ({reqAsset.unit})</Text>
              <TextInput
                style={styles.formInput}
                value={reqAmount}
                onChangeText={setReqAmount}
                placeholder={reqAsset.id ? '0.00' : '1000'}
                placeholderTextColor={theme.colors.text.tertiary}
                keyboardType="decimal-pad"
              />

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={styles.formInput}
                value={reqNote}
                onChangeText={setReqNote}
                placeholder="What's it for?"
                placeholderTextColor={theme.colors.text.tertiary}
              />

              <View style={styles.formActions}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowRequest(false)} disabled={reqBusy}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateRequest} disabled={reqBusy} activeOpacity={0.85}>
                  {reqBusy ? (
                    <ActivityIndicator size="small" color={theme.colors.text.inverse} />
                  ) : (
                    <Text style={styles.primaryBtnText}>Create & Send</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Direct send amount sheet */}
      <Modal visible={showSend} transparent animationType="slide" onRequestClose={() => setShowSend(false)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowSend(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.formTitle}>Send to {contactName}</Text>
              <Text style={styles.sheetDesc}>{contactLud16}</Text>

              <Text style={styles.fieldLabel}>Amount (sats)</Text>
              <TextInput
                style={styles.formInput}
                value={sendAmount}
                onChangeText={setSendAmount}
                placeholder="1000"
                placeholderTextColor={theme.colors.text.tertiary}
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={styles.formInput}
                value={sendNote}
                onChangeText={setSendNote}
                placeholder="Add a message"
                placeholderTextColor={theme.colors.text.tertiary}
              />

              <View style={styles.formActions}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowSend(false)}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleConfirmSendAmount} activeOpacity={0.85}>
                  <Text style={styles.primaryBtnText}>Review</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <PaymentConfirmationModal
        visible={!!pending}
        paymentDetails={pending?.details ?? null}
        onConfirm={confirmPay}
        onCancel={() => !payLoading && setPending(null)}
        loading={payLoading}
      />
    </View>
  );
}

const DaySeparator = ({ createdAt }: { createdAt: number }) => (
  <View style={styles.daySep}>
    <Text style={styles.daySepText}>{formatDay(createdAt)}</Text>
  </View>
);

const mineMuted = (mine: boolean) => (mine ? 'rgba(255,255,255,0.85)' : theme.colors.text.tertiary);

const formatTime = (unixSeconds: number) =>
  new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayKey = (unixSeconds: number) => new Date(unixSeconds * 1000).toDateString();

const formatDay = (unixSeconds: number) => {
  const d = new Date(unixSeconds * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background.secondary },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    backgroundColor: theme.colors.surface.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.light,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(43,238,121,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: { width: '100%', height: '100%' },
  headerAvatarInitial: { fontSize: theme.typography.fontSize.lg, fontWeight: '700', color: theme.colors.primary[500] },
  headerTitleArea: { flex: 1 },
  headerName: { fontSize: theme.typography.fontSize.base, fontWeight: '700', color: theme.colors.text.primary },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  headerSub: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
  schemeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  schemeBtnText: { fontSize: 11, fontWeight: '700', color: theme.colors.primary[500] },
  listContent: { paddingHorizontal: theme.spacing[4], paddingVertical: theme.spacing[4], flexGrow: 1 },
  daySep: { alignItems: 'center', marginVertical: theme.spacing[3] },
  daySepText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
    backgroundColor: theme.colors.surface.tertiary,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 3,
    borderRadius: theme.borderRadius.full,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', marginBottom: theme.spacing[2] },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '84%',
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
  },
  bubbleMine: { backgroundColor: theme.colors.primary[500], borderBottomRightRadius: theme.borderRadius.sm },
  bubbleTheirs: {
    backgroundColor: theme.colors.surface.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
    borderBottomLeftRadius: theme.borderRadius.sm,
  },
  msgText: { fontSize: theme.typography.fontSize.base, lineHeight: 22, color: theme.colors.text.primary },
  msgTextMine: { color: theme.colors.text.inverse },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginTop: theme.spacing[1] },
  time: { fontSize: 10, color: theme.colors.text.tertiary },
  timeMine: { color: 'rgba(255,255,255,0.85)' },
  // Receipts
  receiptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginVertical: theme.spacing[1] },
  receiptText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, fontWeight: '600' },
  // Structured payment-request card
  reqCard: { minWidth: 200 },
  reqHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: theme.spacing[2] },
  reqIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(43,238,121,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqHeadText: { fontSize: theme.typography.fontSize.xs, fontWeight: '700', color: theme.colors.text.secondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  reqAmount: { fontSize: theme.typography.fontSize['2xl'], fontWeight: '800', color: theme.colors.text.primary },
  reqDesc: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, marginTop: 2 },
  reqStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: theme.spacing[3] },
  reqStatusText: { fontSize: theme.typography.fontSize.sm, fontWeight: '700', color: theme.colors.text.tertiary },
  reqCopy: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: theme.spacing[2] },
  reqCopyText: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: theme.spacing[2] },
  payHint: { fontSize: theme.typography.fontSize.sm, fontWeight: '600' },
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
  },
  payBtnAlt: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.primary[500] },
  payBtnText: { fontSize: theme.typography.fontSize.sm, fontWeight: '700', color: theme.colors.text.inverse },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: Platform.OS === 'ios' ? theme.spacing[6] : theme.spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.primary,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.tertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.light,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    borderRadius: theme.borderRadius.xl,
    backgroundColor: theme.colors.surface.tertiary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing[8],
    gap: theme.spacing[2],
  },
  centerTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginTop: theme.spacing[2],
  },
  centerDesc: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.tertiary, textAlign: 'center' },
  connectBtn: {
    marginTop: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
  },
  connectBtnText: { fontSize: theme.typography.fontSize.base, fontWeight: '700', color: theme.colors.text.inverse },
  // Sheets
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: theme.colors.background.secondary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border.medium,
    marginBottom: theme.spacing[4],
  },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], paddingVertical: theme.spacing[3] },
  sheetIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.tertiary,
  },
  sheetTitle: { fontSize: theme.typography.fontSize.base, fontWeight: '700', color: theme.colors.text.primary },
  sheetDesc: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.tertiary, marginTop: 1 },
  formSheet: {
    backgroundColor: theme.colors.background.secondary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[8],
  },
  formTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  fieldLabel: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.secondary,
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] },
  chip: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.tertiary,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  chipActive: { backgroundColor: theme.colors.primary[500], borderColor: theme.colors.primary[500] },
  chipText: { fontSize: theme.typography.fontSize.sm, fontWeight: '600', color: theme.colors.text.secondary },
  chipTextActive: { color: theme.colors.text.inverse },
  formInput: {
    backgroundColor: theme.colors.surface.tertiary,
    borderWidth: 1,
    borderColor: theme.colors.border.medium,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
  },
  formActions: { flexDirection: 'row', gap: theme.spacing[3], marginTop: theme.spacing[5] },
  secondaryBtn: {
    flex: 1,
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: theme.typography.fontSize.base, fontWeight: '700', color: theme.colors.text.secondary },
  primaryBtn: {
    flex: 1,
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { fontSize: theme.typography.fontSize.base, fontWeight: '700', color: theme.colors.text.inverse },
  // Scheme picker rows
  schemeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    marginTop: theme.spacing[3],
  },
  schemeRowActive: { borderColor: theme.colors.primary[500], backgroundColor: 'rgba(43,238,121,0.06)' },
  schemeRowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  schemeName: { fontSize: theme.typography.fontSize.base, fontWeight: '700', color: theme.colors.text.primary },
  schemeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface.tertiary,
  },
  schemeBadgeRec: { backgroundColor: 'rgba(43,238,121,0.16)' },
  schemeBadgeText: { fontSize: 9, fontWeight: '800', color: theme.colors.text.tertiary, textTransform: 'uppercase' },
  schemeBadgeTextRec: { color: theme.colors.primary[500] },
  schemeTagline: { fontSize: theme.typography.fontSize.xs, color: theme.colors.text.tertiary, marginTop: 2, fontWeight: '600' },
  schemeDesc: { fontSize: theme.typography.fontSize.sm, color: theme.colors.text.secondary, marginTop: 4, lineHeight: 18 },
});
