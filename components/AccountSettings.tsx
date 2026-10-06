import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
import DatabaseService from '../services/DatabaseService';
import { currentBarkHost } from '../services/protocols/barkPreferences';
import { getDefaultArkadeServerUrl, NETWORK_LABEL, type ProtocolNetwork } from '../services/protocols/networkConfig';
import { validateAccountEndpoint } from '../services/protocols/accountEndpoints';

type Props = {
  account: 'RGB' | 'SPARK' | 'ARKADE' | 'BARK'; walletId: number; network: string;
  connected: boolean; busy: boolean; error?: string; onNetwork: () => void;
  onReconnect: () => void; onConnection?: () => void;
  onSave: (config: Record<string, unknown>) => void;
  /** Whether this wallet uses the account; with onEnabled, a switch turns it on or off. */
  enabled?: boolean;
  onEnabled?: (on: boolean) => void;
  /** Account-specific sections after the common ones (e.g. RGB on this phone). */
  children?: React.ReactNode;
};
const USE_TEXT: Record<Props['account'], string> = {
  RGB: 'RGB assets on your RGB Lightning Node or on this phone.',
  SPARK: 'Bitcoin, Lightning and tokens. Turning it off hides its balance until you turn it on again.',
  ARKADE: 'Low-fee off-chain bitcoin. Turning it off hides its balance until you turn it on again.',
  BARK: 'Bitcoin on Second’s Ark network. Turning it off hides its balance until you turn it on again.',
};
export function AccountSettings(props: Props) {
  const theme = useAppTheme();
  const [server, setServer] = useState('');
  const [explorer, setExplorer] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    if (props.account !== 'ARKADE') return;
    DatabaseService.getInstance().getWalletNetworks(props.walletId).then(networks => {
      const stored = networks.find(n => n.type === 'arkade');
      const config = stored?.config ? JSON.parse(stored.config) : {};
      if (mounted) { setServer(config.arkServerUrl || getDefaultArkadeServerUrl(props.network as ProtocolNetwork)); setExplorer(config.esploraUrl || ''); setReady(true); }
    }).catch(() => { if (mounted) setError('Could not load account settings. Reopen this page to try again.'); });
    return () => { mounted = false; };
  }, [props.account, props.walletId, props.network]);
  const styles = StyleSheet.create({
    card: { backgroundColor: theme.colors.background.secondary, borderRadius: 16, padding: theme.spacing[4], gap: theme.spacing[3], marginBottom: theme.spacing[4] },
    title: { color: theme.colors.text.primary, fontSize: 16, fontWeight: '600' },
    text: { color: theme.colors.text.secondary, fontSize: 14, lineHeight: 21 },
    action: { minHeight: 48, justifyContent: 'center' },
    link: { color: theme.colors.primary[500], fontSize: 16 },
    input: { color: theme.colors.text.primary, borderColor: theme.colors.text.tertiary, borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 48 },
    error: { color: theme.colors.error[500], fontSize: 14 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 48 },
    primary: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary[500] },
    primaryText: { color: theme.colors.text.inverse, fontSize: 16, fontWeight: '600' },
  });
  const action = (label: string, onPress: () => void, disabled = props.busy) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[styles.action, disabled && { opacity: 0.5 }]} onPress={onPress}><Text style={styles.link}>{label}</Text></TouchableOpacity>;
  const host = props.account === 'BARK' ? currentBarkHost() : null;
  const off = props.onEnabled && props.enabled === false;
  const isRgb = props.account === 'RGB';
  return <>
    {props.onEnabled && <View style={styles.card}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Use this account</Text>
          <Text style={styles.text}>{USE_TEXT[props.account]}</Text>
        </View>
        <Switch accessibilityLabel="Use this account" value={!!props.enabled} disabled={props.busy} onValueChange={props.onEnabled}
          trackColor={{ true: theme.colors.primary[500], false: theme.colors.gray[300] }} />
      </View>
    </View>}
    {!off && !isRgb && <View style={styles.card}>
      <Text style={styles.title}>{props.busy ? 'Connecting…' : props.connected ? 'Connected' : 'Offline'}</Text>
      {/* Arkade's "signet" setting runs on Mutinynet; Bark's is plain Signet. */}
      <Text style={styles.text}>Network: {props.account === 'BARK' && props.network === 'signet' ? 'Signet' : NETWORK_LABEL[props.network as ProtocolNetwork] ?? props.network}</Text>
      {!!props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
      {action('Change network', props.onNetwork)}
      <Text style={styles.text}>Each network has its own balance. Mainnet uses real bitcoin; test networks use test bitcoin.</Text>
      {action('Reconnect account', props.onReconnect)}
      <Text style={styles.text}>Reconnect using the saved configuration if this account is offline or out of sync.</Text>
    </View>}
    {isRgb && <View style={styles.card}>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>RGB Lightning Node</Text>
          <Text style={[styles.text, { color: props.connected ? theme.colors.primary[500] : theme.colors.text.tertiary }]}>
            {props.connected ? 'Connected over Nostr Wallet Connect' : 'Not connected'}
          </Text>
        </View>
      </View>
      <Text style={styles.text}>Your own RGB Lightning Node (RLN) adds Lightning payments, channels and KaleidoSwap swaps for RGB assets. While it’s connected it is your RGB account; otherwise RGB on this phone is used.</Text>
      {!props.connected && <View style={{ gap: theme.spacing[1] }}>
        <Text style={[styles.text, { color: theme.colors.text.primary, fontWeight: '600' }]}>How to connect</Text>
        <Text style={styles.text}>1. On your node, create a Nostr Wallet Connect (NWC) connection and show its QR code or copy its link.</Text>
        <Text style={styles.text}>2. Tap Connect node, then scan the QR code or paste the nostr+walletconnect:// link.</Text>
        <Text style={styles.text}>3. Review the permissions and confirm.</Text>
      </View>}
      {!!props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
      {props.onConnection && <TouchableOpacity accessibilityRole="button" onPress={props.onConnection} style={styles.primary}>
        <Text style={styles.primaryText}>{props.connected ? 'Manage node connection' : 'Connect node'}</Text>
      </TouchableOpacity>}
    </View>}
    {isRgb && props.children ? <Text style={[styles.title, { marginBottom: theme.spacing[2] }]}>RGB on this phone</Text> : null}
    {!off && props.account === 'SPARK' && <View style={styles.card}><Text style={styles.title}>Spark connection</Text><Text style={styles.text}>Spark selects its service endpoints automatically for the chosen network. Custom servers are not supported by this connection.</Text></View>}
    {!off && props.account === 'BARK' && <View style={styles.card}><Text style={styles.title}>Connection details</Text><Text style={styles.text}>Current connection: {host?.network ?? 'Not configured'}</Text><Text style={styles.text}>Ark server</Text><Text selectable style={styles.text}>{host?.arkServerUrl || 'Not configured'}</Text><Text style={styles.text}>Bitcoin explorer</Text><Text selectable style={styles.text}>{host?.esploraUrl || 'Not configured'}</Text><Text style={styles.text}>These endpoints are managed by the Bark wallet. Reconnect retries the saved connection.</Text></View>}
    {!off && props.account === 'ARKADE' && <View style={styles.card}>
      <Text style={styles.title}>Server settings</Text><Text style={styles.text}>Use endpoints for the selected network. Saving reconnects this account.</Text>
      <Text style={styles.text}>Ark server</Text><TextInput accessibilityLabel="Ark server URL" style={styles.input} value={server} onChangeText={setServer} editable={ready && !props.busy} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text style={styles.text}>Bitcoin explorer (optional)</Text><TextInput accessibilityLabel="Bitcoin explorer URL" style={styles.input} value={explorer} onChangeText={setExplorer} editable={ready && !props.busy} placeholder="Default explorer" placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {action('Use network defaults', () => { setServer(getDefaultArkadeServerUrl(props.network as ProtocolNetwork)); setExplorer(''); setError(''); }, !ready || props.busy)}
      {action('Save and reconnect', () => { try { const arkServerUrl = validateAccountEndpoint(server); const esploraUrl = explorer.trim() ? validateAccountEndpoint(explorer) : undefined; setError(''); props.onSave({ arkServerUrl, esploraUrl }); } catch (e) { setError((e as Error).message); } }, !ready || props.busy)}
    </View>}
    {props.children}
  </>;
}
