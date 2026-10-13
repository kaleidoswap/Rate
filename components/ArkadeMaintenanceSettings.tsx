import { ArkadeExitSettings } from './ArkadeExitSettings';
import { shareArkadeDiagnostics } from '../services/protocols/arkadeDiagnostics';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Switch, ActivityIndicator, Alert, Pressable } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppLanguage } from '../localization/useAppLanguage';
import { Button } from './Button';
import { readArkadeHealth, maintainArkade, ArkadeHealth, MaintenanceAction } from '../services/protocols/arkadeMaintenance';

export function ArkadeMaintenanceSettings({ connected, busy, onSave, onBusyChange, walletId, previewHealth }: {
  /** Development-only data for native UI review; no wallet operations. */
  previewHealth?: ArkadeHealth;
  walletId?: number; connected: boolean; busy: boolean; onSave: (patch: Record<string, unknown>) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const theme = useAppTheme(); const { language } = useAppLanguage();
  const tr = (it: string, en: string) => language === 'it' ? it : en;
  const request = useRef(0);
  const [health, setHealth] = useState<ArkadeHealth>();
  const [renewalDetails, setRenewalDetails] = useState(false);
  const [tools, setTools] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [loading, setLoading] = useState(false); const [working, setWorking] = useState(false);
  const [error, setError] = useState(''); const [result, setResult] = useState(''); const [details, setDetails] = useState(false);
  async function refresh() {
    const version = ++request.current;
    setLoading(true); setError('');
    try { const next = __DEV__ && previewHealth ? previewHealth : await readArkadeHealth(); if (request.current === version) setHealth(next); } catch (e) { if (request.current === version) { setError((e as Error).message); setHealth(undefined); } }
    finally { if (request.current === version) setLoading(false); }
  }
  useEffect(() => { if (connected && !busy) void refresh(); else setHealth(undefined); return () => { request.current++; }; }, [connected, busy, previewHealth]);
  const text = { color: theme.colors.text.secondary, fontSize: 14, lineHeight: 21 };
  const title = { color: theme.colors.text.primary, fontSize: 16, fontWeight: '600' as const };
  const preview = __DEV__ && !!previewHealth;
  const disabled = busy || working || loading || exitBusy || preview;
  async function run(action: MaintenanceAction) {
    if (preview) return;
    setWorking(true); onBusyChange(true); setError(''); setResult('');
    try {
      await maintainArkade(action, () => setResult(tr('Operazione in corso… Attendi la conferma di Arkade.', 'Operation in progress… Waiting for Arkade confirmation.')));
      setResult(tr('Operazione completata.', 'Operation completed.')); await refresh();
    } catch (e) { setResult(''); setError((e as Error).message); }
    finally { setWorking(false); onBusyChange(false); }
  }
  function confirm(action: MaintenanceAction) {
    Alert.alert(tr('Conferma operazione', 'Confirm operation'), tr('Arkade elaborerà i VTXO. Possono applicarsi commissioni di protocollo. Mantieni aperta l’app fino al completamento.', 'Arkade will process your VTXOs. Protocol fees may apply. Keep the app open until completion.'), [
      { text: tr('Annulla', 'Cancel'), style: 'cancel' }, { text: tr('Continua', 'Continue'), onPress: () => void run(action) },
    ]);
  }
  const card = { backgroundColor: theme.colors.background.secondary, borderRadius: theme.borderRadius.lg, padding: theme.spacing[4], gap: theme.spacing[3] };
  const disclosure = (label: string, subtitle: string, open: boolean, toggle: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3], minHeight: 48 }}>
    <View style={{ flex: 1, gap: theme.spacing[1] }}><Text style={title}>{label}</Text><Text style={text}>{subtitle}</Text></View>
    <Text style={title}>{open ? '−' : '+'}</Text>
  </Pressable>;
  return <View style={{ gap: theme.spacing[3], marginBottom: theme.spacing[4] }}>
    <View style={card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={title}>{tr('I tuoi fondi', 'Your funds')}</Text>{connected && <Pressable accessibilityRole="button" accessibilityLabel={tr('Aggiorna stato', 'Refresh status')} disabled={disabled} onPress={() => void refresh()} style={{ backgroundColor: theme.colors.surface.secondary, borderWidth: 1, borderColor: theme.colors.border.light, borderRadius: theme.borderRadius.md, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', opacity: disabled ? 0.4 : 1 }}><Text style={{ ...title, color: theme.colors.primary[500] }}>↻</Text></Pressable>}</View>
      {!connected ? <Text style={text}>{tr('Connetti Arkade per verificare i fondi.', 'Connect Arkade to check your funds.')}</Text> : <>
        {loading && <ActivityIndicator accessibilityLabel={tr('Verifica VTXO', 'Checking VTXOs')} />}
        {health && <>
          <Text style={{ ...title, fontSize: theme.typography.fontSize['2xl'] }}>{health.balance ? `${health.balance.available.toLocaleString(language)} sats` : '—'}</Text>
          <Text style={text}>{tr('Disponibili', 'Available')}</Text>
          {!!health.balance && health.balance.boardingConfirmed + health.balance.boardingUnconfirmed > 0 && <Text style={text}>{tr('Depositi in elaborazione', 'Deposits processing')}: {(health.balance.boardingConfirmed + health.balance.boardingUnconfirmed).toLocaleString(language)} sats</Text>}
          {BigInt(health.recoverable) > 0n && <View style={{ gap: theme.spacing[2] }}>
            <Text style={{ ...text, color: theme.colors.warning[500] }}>{health.recoverable} sats · {tr('da recuperare', 'available to recover')}</Text>
            <Button size="sm" title={tr('Recupera fondi', 'Recover funds')} variant="secondary" disabled={disabled} onPress={() => confirm('recover')} />
          </View>}
          {health.expiring > 0 && <Button size="sm" title={tr('Rinnova ora', 'Renew now')} variant="secondary" disabled={disabled} onPress={() => confirm('renew')} />}
          {!health.persistent && <Text style={{ ...text, color: theme.colors.error[500] }}>{tr('Archivio locale non persistente: verifica la connessione.', 'Local storage is not persistent: check the connection.')}</Text>}
        </>}
        {!!error && <Text accessibilityRole="alert" selectable style={{ ...text, color: theme.colors.error[500] }}>{error}</Text>}
        {!!result && <Text accessibilityLiveRegion="polite" style={text}>{result}</Text>}
        {working && <ActivityIndicator />}
      </>}
    </View>
    {connected && health && <>
      <View style={card}>
        <Text style={title}>{tr('Rinnovo automatico', 'Automatic renewal')}</Text>
        <Text style={text}>{health.renewalPaused ? tr('Sospeso durante l’uscita Bitcoin.', 'Paused during the Bitcoin exit.') : tr('Attivo mentre usi l’app.', 'Active while you use the app.')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] }}>
          <View style={{ flex: 1 }}><Text style={title}>{tr('Anche ad app chiusa', 'Also when the app is closed')}</Text><Text style={text}>{tr('Delega il rinnovo dei fondi compatibili.', 'Delegate renewal of compatible funds.')}</Text></View>
          <Switch accessibilityLabel={tr('Delega offline', 'Offline delegation')} value={health.enabled} disabled={disabled || !health.endpoint} onValueChange={value => onSave({ delegationEnabled: value })} />
        </View>
        {health.enabled && <Text style={{ ...text, color: health.delegateError ? theme.colors.warning[500] : theme.colors.text.secondary }}>{health.delegateError ? tr('Servizio da verificare', 'Service needs checking') : tr(`${health.verified} di ${health.eligible} registrazioni confermate`, `${health.verified} of ${health.eligible} registrations confirmed`)}</Text>}
        {disclosure(tr('Dettagli del rinnovo', 'Renewal details'), tr('Copertura e servizio di delega', 'Coverage and delegation service'), renewalDetails, () => setRenewalDetails(!renewalDetails))}
        {renewalDetails && <>
          <Text style={text}>{tr('Il rinnovo inizia 3 giorni prima della scadenza. La delega copre solo i fondi compatibili; una registrazione non garantisce un rinnovo futuro.', 'Renewal starts 3 days before expiry. Delegation covers compatible funds only; registration does not guarantee a future renewal.')}</Text>
          {health.nextExpiry && <Text style={text}>{tr('Prossima scadenza: ', 'Next expiry: ')}{new Date(health.nextExpiry).toLocaleDateString(language)}</Text>}
          {health.delegateFee !== undefined && <Text style={text}>{tr('Commissione del servizio', 'Service fee')}: {health.delegateFee} sats</Text>}
          {!!health.lastDelegatedAt && <Text style={text}>{tr('Ultima registrazione: ', 'Last registration: ')}{new Date(health.lastDelegatedAt).toLocaleString(language)}</Text>}
          <Text selectable style={text}>{health.endpoint ?? tr('Nessun servizio configurato.', 'No service configured.')}</Text>
          {!!health.delegateError && <Text selectable style={text}>{health.delegateError}</Text>}
          <Text style={text}>{tr('Disattivare la delega non revoca le autorizzazioni già firmate.', 'Disabling delegation does not revoke previously signed authorizations.')}</Text>
          {health.enabled && <Button size="sm" title={tr('Verifica e registra delega', 'Verify & register delegation')} variant="secondary" disabled={disabled || !!health.delegateError || !health.eligible || health.delegateFee !== '0'} onPress={() => confirm('delegate')} />}
        </>}
      </View>
      <View style={card}>
        {disclosure(tr('Dettagli dei fondi', 'Fund details'), `${health.count} VTXO · ${health.expiring} ${tr('da rinnovare', 'due for renewal')}`, details, () => setDetails(!details))}
        {details && <>
          <Text style={text}>{tr('I VTXO sono le singole parti del saldo Arkade.', 'VTXOs are the individual parts of your Arkade balance.')}</Text>
          {BigInt(health.subdust) > 0n && <Text style={text}>{tr('Sotto la soglia minima', 'Below minimum threshold')}: {health.subdust} sats</Text>}
          {health.coins.map(coin => <View key={coin.id} style={{ paddingVertical: theme.spacing[2], borderTopWidth: 1, borderColor: theme.colors.border.light, gap: theme.spacing[1] }}><Text style={title}>{coin.sats} sats · {coin.state}</Text><Text selectable style={text}>{coin.id.slice(0, 12)}…{coin.id.slice(-6)}</Text>{coin.expiry && <Text style={text}>{tr('Scadenza: ', 'Expires: ')}{new Date(coin.expiry).toLocaleDateString(language)}</Text>}</View>)}
        </>}
      </View>
    </>}
    {connected && <View style={card}>
      {disclosure(tr('Assistenza e recupero avanzato', 'Support & advanced recovery'), tr('Diagnostica e uscita su Bitcoin', 'Diagnostics and Bitcoin exit'), tools, () => setTools(!tools))}
      {tools && <>
        {!!walletId && <Button size="sm" title={tr('Esporta diagnostica', 'Export diagnostics')} variant="secondary" disabled={disabled} onPress={() => { setLoading(true); void shareArkadeDiagnostics(walletId).catch(() => setError(tr('Esportazione non riuscita.', 'Export failed.'))).finally(() => setLoading(false)); }} />}
        {!preview && <ArkadeExitSettings busy={busy || working || loading} onBusyChange={value => { setExitBusy(value); onBusyChange(value); if (!value) void refresh(); }} />}
      </>}
    </View>}
  </View>;
}
