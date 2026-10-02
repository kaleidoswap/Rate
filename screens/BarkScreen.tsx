import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import {
  MetricCard,
  SummaryRows,
  Surface,
  FormField,
  ToneBadge,
} from '../components/ui/surfaces';
import { Typography } from '../components/ui/typography';
import { NoticeBar } from '../components/ui/overlays';
import { RecordList, RecordItem } from '../components/ui/lists';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { CopyButton } from '../components/CopyButton';
import { Button } from '../components/Button';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAppTheme } from '../theme/ThemeProvider';
import { useBark } from '../hooks/useBark';
import {
  barkNetworkLabel,
  createBarkReceive,
  getBarkBoardingTerms,
  boardBarkFunds,
} from '../services/BarkService';

export default function BarkScreen({ navigation }: { navigation: any }) {
  const theme = useAppTheme();
  const bark = useBark();
  const [kind, setKind] = useState<'ark' | 'lightning' | 'onchain'>('ark');
  const [sats, setSats] = useState('');
  const [receive, setReceive] = useState('');
  const [busy, setBusy] = useState(false);
  const [boardSats, setBoardSats] = useState('');
  useFocusEffect(
    useCallback(() => {
      void bark.refresh({ sync: true });
    }, [bark.refresh])
  );
  const text = { color: theme.colors.text.primary };
  const section = { marginBottom: theme.spacing[4] };
  const action = (label: string, fn: () => void, disabled = false) => (
    <Button
      title={label}
      onPress={fn}
      disabled={disabled}
      variant="secondary"
    />
  );
  const generate = async () => {
    setBusy(true);
    setReceive('');
    try {
      setReceive(await createBarkReceive(kind, Number(sats)));
    } catch (e) {
      Alert.alert(
        'Bark receive',
        e instanceof Error ? e.message : 'Could not create receive request'
      );
    } finally {
      setBusy(false);
    }
  };
  const confirmBoard = async () => {
    const value = Number(boardSats);
    if (!Number.isSafeInteger(value) || value <= 0) {
      Alert.alert('Board funds', 'Enter a positive whole number of sats.');
      return;
    }
    setBusy(true);
    try {
      const terms = await getBarkBoardingTerms();
      if (value < terms.minBoardAmountSats)
        throw new Error(
          `Minimum boarding amount: ${terms.minBoardAmountSats} sats.`
        );
      Alert.alert(
        'Move on-chain funds into Bark?',
        `${value.toLocaleString()} sats on ${barkNetworkLabel()}. Network fees apply. Bark requires ${terms.requiredConfirmations} confirmations.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setBusy(false) },
          {
            text: 'Board funds',
            onPress: () => {
              void (async () => {
                try {
                  await boardBarkFunds(value);
                  setBoardSats('');
                  Alert.alert(
                    'Boarding submitted',
                    'Sync to follow confirmation and settlement.'
                  );
                  await bark.refresh({ sync: true });
                } catch (e) {
                  Alert.alert(
                    'Check boarding status',
                    (e as any)?.code === 'PAYMENT_OUTCOME_UNKNOWN'
                      ? 'Boarding may have been submitted. Sync and check pending boarding before retrying.'
                      : e instanceof Error
                        ? e.message
                        : 'Boarding failed'
                  );
                } finally {
                  setBusy(false);
                }
              })();
            },
          },
        ],
        { cancelable: false }
      );
    } catch (e) {
      setBusy(false);
      Alert.alert(
        'Board funds',
        e instanceof Error ? e.message : 'Could not read boarding terms'
      );
    }
  };
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background.primary }}
    >
      <ScreenHeader title="Bark" subtitle={barkNetworkLabel()} />
      <ScrollView contentContainerStyle={{ padding: theme.spacing[6] }}>
        <Surface style={section}>
          <ToneBadge
            label={`${bark.connected ? 'Connected' : 'Not connected'} · ${barkNetworkLabel()}`}
            tone={bark.connected ? 'success' : 'muted'}
          />
          {bark.loading && (
            <ActivityIndicator color={theme.colors.primary[500]} />
          )}
          {!!bark.error && <NoticeBar tone="danger">{bark.error}</NoticeBar>}
          {!!bark.info && (
            <Text style={text}>Recovery: {bark.info.recovery}</Text>
          )}
          {(bark.info?.recovery === 'failed' ||
            bark.info?.recovery === 'incomplete') && (
            <NoticeBar tone="warning">
              Recovery is incomplete; balances may omit funds.
            </NoticeBar>
          )}
          {action(
            'Sync account',
            () => void bark.refresh({ sync: true }),
            bark.loading || busy
          )}
        </Surface>
        {!!bark.balance && (
          <Surface style={section}>
            <MetricCard
              label="Available on Bark"
              value={`${bark.balance.spendableSats.toLocaleString()} sats`}
              tone="primary"
            />
            <SummaryRows
              rows={[
                {
                  label: 'Pending round',
                  value: `${bark.balance.pendingInRoundSats} sats`,
                },
                {
                  label: 'Pending boarding',
                  value: `${bark.balance.pendingBoardSats} sats`,
                },
                {
                  label: 'Pending Lightning send',
                  value: `${bark.balance.pendingLightningSendSats} sats`,
                },
                {
                  label: 'Claimable Lightning receive',
                  value: `${bark.balance.claimableLightningReceiveSats} sats`,
                },
                {
                  label: 'Pending exit',
                  value: `${bark.balance.pendingExitSats} sats`,
                },
                {
                  label: 'On-chain funding',
                  value: `${bark.onchain?.confirmedSats ?? 0} sats confirmed`,
                  hint: `${bark.onchain?.pendingSats ?? 0} pending`,
                },
              ]}
            />
            {action(
              'Send from Bark',
              () => navigation.navigate('Send', { preferredAccount: 'BARK' }),
              busy || bark.loading
            )}
          </Surface>
        )}
        <Surface style={section}>
          <Typography role="title" accessibilityRole="header">
            Receive on Bark
          </Typography>
          <Text style={{ color: theme.colors.text.secondary }}>
            Use the same network and Bark server as the sender. Arkade addresses
            are not interchangeable with Bark.
          </Text>
          <SegmentedTabs
            value={kind}
            onChange={(mode) => {
              setKind(mode);
              setReceive('');
            }}
            options={[
              { key: 'ark', label: 'Ark', disabled: busy },
              { key: 'lightning', label: 'Lightning', disabled: busy },
              { key: 'onchain', label: 'On-chain funding', disabled: busy },
            ]}
          />
          {kind === 'lightning' && (
            <FormField
              label="Lightning amount in sats"
              placeholder="Amount in sats"
              keyboardType="number-pad"
              value={sats}
              onChangeText={(v) => {
                setSats(v);
                setReceive('');
              }}
              editable={!busy}
            />
          )}
          {kind === 'onchain' && (
            <Text style={text}>
              This funds the separate on-chain wallet. After confirmation, enter
              an amount below to board it into Bark.
            </Text>
          )}
          {action(
            busy ? 'Generating…' : 'Generate receive request',
            () => void generate(),
            busy || !bark.connected || bark.loading
          )}
          {!!receive && (
            <View style={{ alignItems: 'center', gap: theme.spacing[4] }}>
              <QRCode value={receive} size={220} />
              <Text selectable style={text}>
                {receive}
              </Text>
              <CopyButton value={receive} label="Copy request" />
            </View>
          )}
        </Surface>
        {!!bark.onchain && (
          <Surface style={section}>
            <Typography role="title" accessibilityRole="header">
              Board on-chain funds
            </Typography>
            <Text style={text}>
              Moves confirmed funding into Bark. Leave enough on-chain funds for
              fees.
            </Text>
            <FormField
              label="Boarding amount in sats"
              placeholder="Amount in sats"
              keyboardType="number-pad"
              value={boardSats}
              onChangeText={setBoardSats}
              editable={!busy}
            />

            {action(
              'Review boarding',
              () => void confirmBoard(),
              busy || bark.loading || !bark.connected
            )}
          </Surface>
        )}
        <Surface style={section}>
          <Typography role="title" accessibilityRole="header">
            Bark activity · {barkNetworkLabel()}
          </Typography>
          {!bark.transactions?.length && (
            <Text style={text}>
              {bark.connected
                ? 'No activity yet. Sync after receiving a payment.'
                : 'Connect to load activity.'}
            </Text>
          )}
          <RecordList>
            {bark.transactions?.map((tx) => (
              <RecordItem
                key={tx.id}
                title={`${tx.type === 'send' ? 'Sent' : tx.type === 'receive' ? 'Received' : tx.type} · ${tx.amount.toLocaleString()} sats`}
                description={new Date(tx.timestamp).toLocaleString()}
                trailing={
                  <ToneBadge
                    label={tx.status}
                    tone={
                      tx.status === 'confirmed'
                        ? 'success'
                        : tx.status === 'failed'
                          ? 'danger'
                          : 'warning'
                    }
                  />
                }
              >
                <Typography role="caption" mono selectable muted>
                  {tx.id}
                </Typography>
              </RecordItem>
            ))}
          </RecordList>
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}
