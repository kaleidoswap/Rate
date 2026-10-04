import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
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
  });
  const action = (label: string, onPress: () => void, disabled = props.busy) => <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} style={[styles.action, disabled && { opacity: 0.5 }]} onPress={onPress}><Text style={styles.link}>{label}</Text></TouchableOpacity>;
  const host = props.account === 'BARK' ? currentBarkHost() : null;
  return <>
    <View style={styles.card}>
      <Text style={styles.title}>{props.busy ? 'Connecting…' : props.connected ? 'Connected' : 'Offline'}</Text>
      {/* Arkade's "signet" setting runs on Mutinynet; Bark's is plain Signet. */}
      <Text style={styles.text}>Network: {props.account === 'BARK' && props.network === 'signet' ? 'Signet' : NETWORK_LABEL[props.network as ProtocolNetwork] ?? props.network}</Text>
      {!!props.error && <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text>}
      {action('Change network', props.onNetwork)}
      <Text style={styles.text}>Each network has its own balance. Mainnet uses real bitcoin; test networks use test bitcoin.</Text>
      {action('Reconnect account', props.onReconnect)}
      <Text style={styles.text}>Reconnect using the saved configuration if this account is offline or out of sync.</Text>
    </View>
    {props.account === 'RGB' && props.onConnection && <View style={styles.card}><Text style={styles.title}>Wallet connection</Text><Text style={styles.text}>Manage your Lightning wallet connection and review the permissions granted to this app.</Text>{action('Manage wallet connection', props.onConnection)}</View>}
    {props.account === 'SPARK' && <View style={styles.card}><Text style={styles.title}>Spark connection</Text><Text style={styles.text}>Spark selects its service endpoints automatically for the chosen network. Custom servers are not supported by this connection.</Text></View>}
    {props.account === 'BARK' && <View style={styles.card}><Text style={styles.title}>Connection details</Text><Text style={styles.text}>Current connection: {host?.network ?? 'Not configured'}</Text><Text style={styles.text}>Ark server</Text><Text selectable style={styles.text}>{host?.arkServerUrl || 'Not configured'}</Text><Text style={styles.text}>Bitcoin explorer</Text><Text selectable style={styles.text}>{host?.esploraUrl || 'Not configured'}</Text><Text style={styles.text}>These endpoints are managed by the Bark wallet. Reconnect retries the saved connection.</Text></View>}
    {props.account === 'ARKADE' && <View style={styles.card}>
      <Text style={styles.title}>Server settings</Text><Text style={styles.text}>Use endpoints for the selected network. Saving reconnects this account.</Text>
      <Text style={styles.text}>Ark server</Text><TextInput accessibilityLabel="Ark server URL" style={styles.input} value={server} onChangeText={setServer} editable={ready && !props.busy} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text style={styles.text}>Bitcoin explorer (optional)</Text><TextInput accessibilityLabel="Bitcoin explorer URL" style={styles.input} value={explorer} onChangeText={setExplorer} editable={ready && !props.busy} placeholder="Default explorer" placeholderTextColor={theme.colors.text.tertiary} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {action('Use network defaults', () => { setServer(getDefaultArkadeServerUrl(props.network as ProtocolNetwork)); setExplorer(''); setError(''); }, !ready || props.busy)}
      {action('Save and reconnect', () => { try { const arkServerUrl = validateAccountEndpoint(server); const esploraUrl = explorer.trim() ? validateAccountEndpoint(explorer) : undefined; setError(''); props.onSave({ arkServerUrl, esploraUrl }); } catch (e) { setError((e as Error).message); } }, !ready || props.busy)}
    </View>}
  </>;
}
