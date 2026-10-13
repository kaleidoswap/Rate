import { ArkadeExitSettings } from './ArkadeExitSettings';
import { shareArkadeDiagnostics } from '../services/protocols/arkadeDiagnostics';
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Switch, ActivityIndicator, Alert } from 'react-native';
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
  return <View style={{ backgroundColor: theme.colors.background.secondary, borderRadius: 16, padding: 16, gap: 12, marginBottom: 16 }}>
    <Text style={title}>{tr('Rinnovo e recupero', 'Renewal & recovery')}</Text>

    {!connected ? <Text style={text}>{tr('Connetti Arkade per verificare i fondi.', 'Connect Arkade to check your funds.')}</Text> : <>
      {loading && <ActivityIndicator accessibilityLabel={tr('Verifica VTXO', 'Checking VTXOs')} />}
      {!!error && <Text accessibilityRole="alert" selectable style={{ ...text, color: theme.colors.error[500] }}>{error}</Text>}
      {health && <>
        <Text style={title}>{tr('Disponibili', 'Available')}: {health.balance?.available.toLocaleString(language)} sats</Text>
        {!!health.balance && (health.balance.boardingConfirmed + health.balance.boardingUnconfirmed > 0) && <Text style={text}>{tr('Depositi in elaborazione', 'Deposits processing')}: {(health.balance.boardingConfirmed + health.balance.boardingUnconfirmed).toLocaleString(language)} sats</Text>}
        <Text style={title}>{health.count} VTXO · {health.expiring} {tr('da rinnovare', 'due for renewal')}</Text>
        <Text style={text}>{health.renewalPaused ? tr('Rinnovo sospeso per uscita Bitcoin. Riconnetti dopo il completamento.', 'Renewal paused for Bitcoin exit. Reconnect after completion.') : tr('Rinnovo automatico attivo nell’app', 'Automatic renewal active in the app')}</Text>
        {health.nextExpiry && <Text style={text}>{tr('Prossima scadenza: ', 'Next expiry: ')}{new Date(health.nextExpiry).toLocaleDateString(language)}</Text>}
        {!health.persistent && <Text style={{ ...text, color: theme.colors.error[500] }}>{tr('Archivio locale non persistente: verifica la connessione prima di affidarti al rinnovo.', 'Local storage is not persistent: check the connection before relying on renewal.')}</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}><Text style={title}>{tr('Delega offline', 'Offline delegation')}</Text><Text style={text}>{tr('Rinnovo anche quando l’app è chiusa.', 'Renewal even when the app is closed.')}</Text></View>
          <Switch accessibilityLabel={tr('Delega offline', 'Offline delegation')} value={health.enabled} disabled={disabled || !health.endpoint} onValueChange={value => onSave({ delegationEnabled: value })} />
        </View>
        {health.enabled && <>
          <Text style={text}>{health.delegateError ? tr('Servizio non verificato', 'Service not verified') : tr(`Servizio disponibile · ${health.delegateFee} sats`, `Service available · ${health.delegateFee} sats`)}</Text>
          <Text style={text}>{tr(`${health.eligible} compatibili · ${health.verified} con registrazione confermata`, `${health.eligible} compatible · ${health.verified} with confirmed registration`)}</Text>

        </>}

        <Text style={text}>{tr('Recuperabili', 'Recoverable')}: {health.recoverable} sats</Text>
        {BigInt(health.recoverable) > 0n && <Button size="sm" title={tr('Recupera fondi', 'Recover funds')} variant="secondary" disabled={disabled} onPress={() => confirm('recover')} />}
        <Button size="sm" title={details ? tr('Nascondi dettagli', 'Hide details') : tr('Dettagli VTXO', 'VTXO details')} variant="ghost" onPress={() => setDetails(!details)} />
        {details && <>
    {!!walletId && <Button size="sm" title={tr('Esporta diagnostica', 'Export diagnostics')} variant="ghost" disabled={disabled} onPress={() => { setLoading(true); void shareArkadeDiagnostics(walletId).catch(() => setError(tr('Esportazione non riuscita.', 'Export failed.'))).finally(() => setLoading(false)); }} />}
          <Text style={text}>{tr('Il rinnovo automatico inizia 3 giorni prima della scadenza, mentre l’app è attiva. La delega riguarda solo i VTXO compatibili.', 'Automatic renewal starts 3 days before expiry while the app is active. Delegation covers compatible VTXOs only.')}</Text>
        {health.expiring > 0 && <Button size="sm" title={tr('Rinnova ora', 'Renew now')} variant="secondary" disabled={disabled} onPress={() => confirm('renew')} />}
          {health.enabled && <Button size="sm" title={tr('Verifica e registra delega', 'Verify & register delegation')} variant="secondary" disabled={disabled || !!health.delegateError || !health.eligible || health.delegateFee !== '0'} onPress={() => confirm('delegate')} />}

          {!!health.lastDelegatedAt && <Text style={text}>{tr('Ultima registrazione: ', 'Last registration: ')}{new Date(health.lastDelegatedAt).toLocaleString(language)}</Text>}
          <Text style={text}>{tr('La registrazione conferma l’accettazione della delega, non il completamento di un rinnovo futuro.', 'Registration confirms delegation acceptance, not completion of a future renewal.')}</Text>
          <Text style={text}>{tr('I fondi esistenti possono richiedere un rinnovo prima di essere delegabili. Disattivare la delega non revoca le autorizzazioni già firmate.', 'Existing funds may need renewal before they support delegation. Disabling delegation does not revoke previously signed authorizations.')}</Text>
          <Text selectable style={text}>{health.endpoint ?? tr('Nessun servizio configurato per questo operatore.', 'No service configured for this operator.')}</Text>
          {!!health.delegateError && <Text selectable style={text}>{health.delegateError}</Text>}
          <Text style={text}>{tr('Sotto la soglia minima', 'Below minimum threshold')}: {health.subdust} sats</Text>
          {!preview && <ArkadeExitSettings busy={busy || working || loading} onBusyChange={value => { setExitBusy(value); onBusyChange(value); if (!value) void refresh(); }} />}
          {health.coins.map(coin => <View key={coin.id} style={{ paddingVertical: 8 }}><Text style={title}>{coin.sats} sats · {coin.state}</Text><Text selectable style={text}>{coin.id.slice(0, 12)}…{coin.id.slice(-6)}</Text>{coin.expiry && <Text style={text}>{new Date(coin.expiry).toLocaleString(language)}</Text>}</View>)}
        </>}
      </>}
      {!!result && <Text accessibilityLiveRegion="polite" style={text}>{result}</Text>}
      {working && <ActivityIndicator />}
      <Button size="sm" title={tr('Aggiorna stato', 'Refresh status')} variant="ghost" disabled={disabled} onPress={() => void refresh()} />
    </>}
  </View>;
}
