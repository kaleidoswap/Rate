import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../theme/ThemeProvider';
import { useAppLanguage } from '../localization/useAppLanguage';
import { Button } from './Button';
import { arkadeContext } from '../services/protocols/arkadeContext';
import { prepareArkadeExitPreview, saveArkadeExitPackage, readArkadeExit, resumeArkadeExit, shareArkadeExitPackage, ExitPreview, ExitRecord } from '../services/protocols/arkadeExit';

export function ArkadeExitSettings({ busy, onBusyChange }: { busy: boolean; onBusyChange: (value: boolean) => void }) {
  const theme = useAppTheme(); const { language } = useAppLanguage(); const tr = (it: string, en: string) => language === 'it' ? it : en;
  const [expanded, setExpanded] = useState(false);
  const [destination, setDestination] = useState('');
  const [preview, setPreview] = useState<ExitPreview>(); const [record, setRecord] = useState<ExitRecord>();
  const [error, setError] = useState(''); const [working, setWorking] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => { let mounted = true; try { void readArkadeExit(arkadeContext().wallet).then(r => { if (mounted) setRecord(r); }).catch(() => { if (mounted) setError(tr('Backup di uscita non leggibile.', 'Exit backup could not be read.')); }); } catch { /* disconnected parent */ }
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') controller.current?.abort(); });
    return () => { mounted = false; controller.current?.abort(); subscription.remove(); };
  }, []);
  const text = { color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.sm, lineHeight: 21 };
  async function work(fn: () => Promise<void>) { setWorking(true); onBusyChange(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { controller.current = undefined; setWorking(false); onBusyChange(false); } }
  function start() {
    Alert.alert(tr('Avvia uscita su Bitcoin?', 'Start Bitcoin exit?'), tr('Questa azione trasmette transazioni Bitcoin e paga commissioni. Può richiedere giorni. Mettere in pausa non annulla le transazioni già trasmesse. I pagamenti Arkade resteranno bloccati durante l’uscita.', 'This broadcasts Bitcoin transactions and pays fees. It may take days. Pausing does not undo broadcasts. Arkade payments remain blocked during the exit.'), [
      { text: tr('Annulla', 'Cancel'), style: 'cancel' }, { text: tr('Avvia uscita', 'Start exit'), style: 'destructive', onPress: () => void work(async () => {
        controller.current = new AbortController();
        await resumeArkadeExit(arkadeContext().wallet, controller.current.signal, setRecord);
      }) },
    ]);
  }
  return <View style={{ gap: theme.spacing[3], paddingTop: theme.spacing[4] }}>
    <Button title={tr('Uscita di emergenza su Bitcoin', 'Emergency Bitcoin exit')} size="sm" variant="ghost" onPress={() => setExpanded(!expanded)} />
    {expanded && <>
    <Text style={text}>{tr('Per uscire senza la collaborazione del server. Richiede BTC on-chain per le commissioni e l’attesa dei blocchi previsti dal protocollo. Solo VTXO senza token.', 'Exit without server cooperation. Requires on-chain BTC for fees and protocol timelocks. BTC-only VTXOs are supported.')}</Text>
    <Text style={text}>{tr('La delega già firmata non viene revocata. Un backup va rigenerato dopo movimenti o rinnovi dei VTXO.', 'Previously signed delegation is not revoked. Regenerate a backup after spending or renewing VTXOs.')}</Text>
    <Text style={text}>{tr('Mantieni aperta questa schermata durante l’esecuzione. Se esci dall’app, riprendi da qui.', 'Keep this screen open during execution. If you leave the app, resume here.')}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ ...text, color: theme.colors.error[500] }}>{error}</Text>}
    {!record?.started && <TextInput accessibilityLabel={tr('Indirizzo Bitcoin di destinazione', 'Destination Bitcoin address')} placeholder={tr('Indirizzo Bitcoin di destinazione', 'Destination Bitcoin address')} placeholderTextColor={theme.colors.text.tertiary} value={destination} onChangeText={value => { setDestination(value); setPreview(undefined); }} editable={!working && !busy} autoCapitalize="none" autoCorrect={false} style={{ color: theme.colors.text.primary, borderColor: theme.colors.text.tertiary, borderWidth: 1, borderRadius: 12, padding: theme.spacing[3] }} />}
    {!record?.started && <Button title={tr('Calcola costi', 'Estimate costs')} size="sm" variant="secondary" disabled={busy || working} onPress={() => void work(async () => { const { wallet, network } = arkadeContext(); setPreview(await prepareArkadeExitPreview(wallet, network, destination)); })} />}
    {preview && !record?.started && <>
      <Text style={text}>{tr('Importo recuperato stimato', 'Estimated recovered amount')}: {preview.quote.totals.recoveredSats.toLocaleString(language)} sats</Text>
      <Text style={text}>{tr('Commissioni stimate', 'Estimated fees')}: {preview.quote.totals.totalFeeSats.toLocaleString(language)} sats · {preview.quote.totals.txCount} tx</Text>
      <Text style={text}>{tr('BTC da aggiungere per le commissioni', 'BTC needed for fees')}: {preview.quote.shortfallSats.toLocaleString(language)} sats</Text>
      <Text style={text}>{tr('Destinazione', 'Destination')}</Text><Text selectable style={text}>{preview.destination}</Text>
      <Text style={text}>{tr('Indirizzo separato per finanziare le commissioni', 'Separate address for funding fees')}</Text><Text selectable style={text}>{preview.quote.fundingAddress}</Text>
      {!!preview.excludedAssets && <Text style={text}>{preview.excludedAssets} {tr('VTXO con token esclusi.', 'asset-bearing VTXOs excluded.')}</Text>}
      <Button title={tr('Prepara backup di uscita', 'Prepare exit backup')} size="sm" variant="secondary" disabled={busy || working} onPress={() => void work(async () => { setRecord(await saveArkadeExitPackage(arkadeContext().wallet, preview)); })} />
      <Text style={text}>{tr('Firma e salva il piano. Non trasmette transazioni.', 'Signs and saves the plan. Does not broadcast transactions.')}</Text>
    </>}
    {record && <>
      <Text style={text}>{record.completed ? tr('Uscita completata. Riconnetti Arkade per aggiornare il saldo.', 'Exit completed. Reconnect Arkade to refresh the balance.') : record.started ? tr('Uscita iniziata · avanzamento salvato', 'Exit started · progress saved') : tr('Backup pronto · nessuna transazione trasmessa', 'Backup ready · nothing broadcast')}</Text>
      <Text style={text}>{tr('Commissioni stimate', 'Estimated fees')}: {record.package.totals.totalFeeSats} sats</Text>
      <Text style={text}>{tr('Destinazione', 'Destination')}</Text><Text selectable style={text}>{record.package.sweepAddress}</Text>
      {!!record.event && <Text style={text}>{{ skipped: tr('Già elaborata', 'Already processed'), broadcast: tr('Trasmessa', 'Broadcast'), confirmed: tr('Confermata', 'Confirmed'), waiting_csv: tr('Attesa prevista dal protocollo', 'Waiting for timelock'), failed: tr('Da verificare', 'Needs attention'), warning: tr('Avviso', 'Notice') }[record.event.status]} · {record.event.stepIndex + 1}/{record.package.steps.length}</Text>}
      {!!record.event?.maturesAtHeight && <Text style={text}>{tr('Attesa fino al blocco ', 'Waiting until block ')}{record.event.maturesAtHeight}</Text>}
      {!!record.event?.maturesAtTime && <Text style={text}>{new Date(record.event.maturesAtTime * 1000).toLocaleString(language)}</Text>}
      <Button title={tr('Esporta backup', 'Export backup')} size="sm" variant="secondary" disabled={working || busy} onPress={() => void work(() => shareArkadeExitPackage(record))} />
      {!record.completed && <Button title={record.started ? tr('Riprendi uscita', 'Resume exit') : tr('Avvia uscita', 'Start exit')} size="sm" variant="secondary" disabled={working || busy} onPress={start} />}
    </>}
    {working && controller.current && <Button title={tr('Metti in pausa', 'Pause')} size="sm" variant="ghost" onPress={() => controller.current?.abort()} />}
    </>}
  </View>;
}
