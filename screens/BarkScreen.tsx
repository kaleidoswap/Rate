import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, Clipboard, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import QRCode from 'react-native-qrcode-svg'
import { ScreenHeader } from '../components/ScreenHeader'
import { useAppTheme } from '../theme/ThemeProvider'
import { useBark } from '../hooks/useBark'
import { barkNetworkLabel, createBarkReceive, getBarkBoardingTerms, boardBarkFunds } from '../services/BarkService'

export default function BarkScreen({ navigation }: { navigation: any }) {
  const theme = useAppTheme()
  const bark = useBark()
  const [kind, setKind] = useState<'ark' | 'lightning' | 'onchain'>('ark')
  const [sats, setSats] = useState('')
  const [receive, setReceive] = useState('')
  const [busy, setBusy] = useState(false)
  const [boardSats, setBoardSats] = useState('')
  useFocusEffect(useCallback(() => { void bark.refresh({ sync: true }) }, [bark.refresh]))
  const text = { color: theme.colors.text.primary }
  const section = { padding: theme.spacing[6], marginBottom: theme.spacing[4], borderRadius: theme.borderRadius.lg, backgroundColor: theme.colors.background.secondary }
  const action = (label: string, fn: () => void, disabled = false) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={fn}
    style={{ padding: theme.spacing[4], opacity: disabled ? 0.5 : 1 }}><Text style={{ color: theme.colors.primary[500], fontWeight: '600' }}>{label}</Text></TouchableOpacity>
  const generate = async () => {
    setBusy(true); setReceive('')
    try { setReceive(await createBarkReceive(kind, Number(sats))) }
    catch (e) { Alert.alert('Bark receive', e instanceof Error ? e.message : 'Could not create receive request') }
    finally { setBusy(false) }
  }
  const confirmBoard = async () => {
    const value = Number(boardSats)
    if (!Number.isSafeInteger(value) || value <= 0) { Alert.alert('Board funds', 'Enter a positive whole number of sats.'); return }
    setBusy(true)
    try {
      const terms = await getBarkBoardingTerms()
      if (value < terms.minBoardAmountSats) throw new Error(`Minimum boarding amount: ${terms.minBoardAmountSats} sats.`)
      Alert.alert('Move on-chain funds into Bark?', `${value.toLocaleString()} sats on ${barkNetworkLabel()}. Network fees apply. Bark requires ${terms.requiredConfirmations} confirmations.`, [
        { text: 'Cancel', style: 'cancel', onPress: () => setBusy(false) },
        { text: 'Board funds', onPress: () => {
          void (async () => {
            try {
              await boardBarkFunds(value)
              setBoardSats('')
              Alert.alert('Boarding submitted', 'Sync to follow confirmation and settlement.')
              await bark.refresh({ sync: true })
            } catch (e) {
              Alert.alert('Check boarding status', (e as any)?.code === 'PAYMENT_OUTCOME_UNKNOWN'
                ? 'Boarding may have been submitted. Sync and check pending boarding before retrying.'
                : e instanceof Error ? e.message : 'Boarding failed')
            } finally { setBusy(false) }
          })()
        } },
      ], { cancelable: false })
    } catch (e) { setBusy(false); Alert.alert('Board funds', e instanceof Error ? e.message : 'Could not read boarding terms') }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
    <ScreenHeader title="Bark" subtitle={barkNetworkLabel()} />
    <ScrollView contentContainerStyle={{ padding: theme.spacing[6] }}>
      <View style={section}>
        <Text style={text}>{bark.connected ? 'Connected' : 'Not connected'} · {barkNetworkLabel()}</Text>
        {bark.loading && <ActivityIndicator color={theme.colors.primary[500]} />}
        {!!bark.error && <Text accessibilityRole="alert" style={{ color: theme.colors.error[500] }}>{bark.error}</Text>}
        {!!bark.info && <Text style={text}>Recovery: {bark.info.recovery}</Text>}
        {(bark.info?.recovery === 'failed' || bark.info?.recovery === 'incomplete') && <Text style={text}>Recovery is incomplete; balances may omit funds.</Text>}
        {action('Sync account', () => void bark.refresh({ sync: true }), bark.loading || busy)}
      </View>
      {!!bark.balance && <View style={section}>
        <Text style={{ ...text, fontSize: 24, fontWeight: '600' }}>{bark.balance.spendableSats.toLocaleString()} sats</Text>
        <Text style={text}>Available on Bark</Text>
        <Text style={text}>Pending round: {bark.balance.pendingInRoundSats} sats</Text>
        <Text style={text}>Pending boarding: {bark.balance.pendingBoardSats} sats</Text>
        <Text style={text}>Pending Lightning send: {bark.balance.pendingLightningSendSats} sats</Text>
        <Text style={text}>Claimable Lightning receive: {bark.balance.claimableLightningReceiveSats} sats</Text>
        <Text style={text}>Pending exit: {bark.balance.pendingExitSats} sats</Text>
        <Text style={text}>On-chain funding: {bark.onchain?.confirmedSats ?? 0} sats confirmed · {bark.onchain?.pendingSats ?? 0} pending</Text>
        {action('Send from Bark', () => navigation.navigate('Send', { preferredAccount: 'BARK' }), busy || bark.loading)}
      </View>}
      <View style={section}>
        <Text style={{ ...text, fontSize: 18, fontWeight: '600' }}>Receive on Bark</Text>
        <Text style={{ color: theme.colors.text.secondary }}>Use the same network and Bark server as the sender. Arkade addresses are not interchangeable with Bark.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(['ark', 'lightning', 'onchain'] as const).map(mode => <View key={mode}>{action(`${kind === mode ? '✓ ' : ''}${mode === 'ark' ? 'Ark' : mode === 'lightning' ? 'Lightning' : 'On-chain funding'}`, () => { setKind(mode); setReceive('') }, busy)}</View>)}
        </View>
        {kind === 'lightning' && <TextInput accessibilityLabel="Lightning amount in sats" placeholder="Amount in sats" placeholderTextColor={theme.colors.text.tertiary} keyboardType="number-pad" value={sats} onChangeText={v => { setSats(v); setReceive('') }} editable={!busy} style={{ ...text, padding: theme.spacing[4], borderWidth: 1, borderColor: theme.colors.border.light }} />}
        {kind === 'onchain' && <Text style={text}>This funds the separate on-chain wallet. After confirmation, enter an amount below to board it into Bark.</Text>}
        {action(busy ? 'Generating…' : 'Generate receive request', () => void generate(), busy || !bark.connected || bark.loading)}
        {!!receive && <View style={{ alignItems: 'center', gap: theme.spacing[4] }}>
          <QRCode value={receive} size={220} />
          <Text selectable style={text}>{receive}</Text>
          {action('Copy request', () => { Clipboard.setString(receive); Alert.alert('Copied', 'Bark receive request copied.') })}
        </View>}
      </View>
      {!!bark.onchain && <View style={section}>
        <Text style={{ ...text, fontSize: 18, fontWeight: '600' }}>Board on-chain funds</Text>
        <Text style={text}>Moves confirmed funding into Bark. Leave enough on-chain funds for fees.</Text>
        <TextInput accessibilityLabel="Boarding amount in sats" placeholder="Amount in sats" placeholderTextColor={theme.colors.text.tertiary} keyboardType="number-pad" value={boardSats} onChangeText={setBoardSats} editable={!busy} style={{ ...text, padding: theme.spacing[4], borderWidth: 1, borderColor: theme.colors.border.light }} />
        {action('Review boarding', () => void confirmBoard(), busy || bark.loading || !bark.connected)}
      </View>}
      <View style={section}>
        <Text style={{ ...text, fontSize: 18, fontWeight: '600' }}>Bark activity · {barkNetworkLabel()}</Text>
        {!bark.transactions?.length && <Text style={text}>{bark.connected ? 'No activity yet. Sync after receiving a payment.' : 'Connect to load activity.'}</Text>}
        {bark.transactions?.map(tx => <View key={tx.id} style={{ paddingVertical: theme.spacing[4], borderBottomWidth: 1, borderBottomColor: theme.colors.border.light }}>
          <Text style={text}>{tx.type === 'send' ? 'Sent' : tx.type === 'receive' ? 'Received' : tx.type} · {tx.amount.toLocaleString()} sats · {tx.status}</Text>
          <Text style={{ color: theme.colors.text.secondary }}>{new Date(tx.timestamp).toLocaleString()}</Text>
          <Text selectable style={{ color: theme.colors.text.secondary }}>{tx.id}</Text>
        </View>)}
      </View>
    </ScrollView>
  </SafeAreaView>
}
