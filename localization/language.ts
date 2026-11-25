import { prismoItalian } from './prismoItalian';
import { NativeModules, Platform } from 'react-native';
import { getStore } from '../store/storeProvider';
export type AppLanguage = 'en' | 'it';
export type LanguagePreference = AppLanguage | 'system';
export function systemLocale(): string {
  try {
    const settings = NativeModules.SettingsManager?.settings;
    return (Platform.OS === 'ios' ? settings?.AppleLanguages?.[0] || settings?.AppleLocale : NativeModules.I18nManager?.localeIdentifier)
      || Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch { return 'en'; }
}
export function resolveAppLanguage(preference?: string, locale = systemLocale()): AppLanguage {
  const code = (!preference || preference === 'system' ? locale : preference).split(/[-_]/)[0].toLowerCase();
  return code === 'it' ? 'it' : 'en';
}
export function getAppLanguage(): AppLanguage {
  try { return resolveAppLanguage(getStore().getState().settings?.language); }
  catch { return resolveAppLanguage('system'); }
}
const italian: Record<string, string> = {
  Wallet: 'Portafoglio', Activity: 'Attività', Contacts: 'Contatti', Agent: 'Agent', Scan: 'Scansiona',
  Settings: 'Impostazioni', 'Search settings': 'Cerca nelle impostazioni', Preferences: 'Preferenze',
  'Asset list settings': 'Impostazioni lista asset', 'Search assets': 'Cerca asset',
  'Visible assets': 'Asset visibili', 'Show asset': 'Mostra asset', 'All networks': 'Tutte le reti', Network: 'Rete',
  'No matching assets': 'Nessun asset corrispondente', 'No assets yet': 'Nessun asset', Done: 'Fatto',
  'Security & backup': 'Sicurezza e backup', Connections: 'Connessioni', More: 'Altro',
  Language: 'Lingua', 'System language': 'Lingua di sistema', 'App and Prismo voice': 'App e voce di Prismo',
  'Balance unit': 'Unità del saldo', 'Sats, BTC or local currency': 'Sats, BTC o valuta locale',
  'Payment sounds': 'Suoni dei pagamenti', 'Payment notifications': 'Notifiche dei pagamenti',
  Currency: 'Valuta', 'Used for fiat estimates': 'Per le stime in valuta locale',
  'Lightning address': 'Indirizzo Lightning', 'Profile, relays & keys': 'Profilo, relay e chiavi',
  'Models & privacy': 'Modelli e privacy', 'Personalize assistant': 'Personalizza assistente',
  'Agent wallet': 'Portafoglio Agent', 'Wallet connection': 'Connessione portafoglio',
  'Lightning wallet': 'Portafoglio Lightning', Security: 'Sicurezza', 'App lock': 'Blocco app',
  'Change PIN': 'Modifica PIN', 'Turn off PIN': 'Disattiva PIN', 'Set up PIN': 'Imposta PIN',
  'Auto-lock': 'Blocco automatico', 'View recovery phrase': 'Mostra frase di recupero',
  'RGB data backup': 'Backup dati RGB', 'Accounts & networks': 'Account e reti',
  'Interface detail': 'Dettagli interfaccia', 'Display detail': 'Livello di dettaglio',
  'Remove from this device': 'Rimuovi da questo dispositivo', Cancel: 'Annulla', Save: 'Salva',
  'Export voice diagnostics': 'Esporta diagnostica vocale', 'Voice details & retry': 'Dettagli voce e riprova',
  'Generating voice…': 'Generazione della voce…',
  Labs: 'Labs', 'Experimental features you can turn on': 'Funzioni sperimentali da attivare',
  'Experimental features are still being tested. Turn one on to try it; your funds stay in their accounts whether it is on or off.':
    'Le funzioni sperimentali sono ancora in prova. Attivane una per provarla: i tuoi fondi restano nei loro account, che sia attiva o no.',
  'Development build: every feature starts on.': 'Build di sviluppo: tutte le funzioni partono attive.',
  'Arkade account': 'Account Arkade', 'Low-fee off-chain bitcoin on Ark': 'Bitcoin off-chain a basse commissioni su Ark',
  'On-device assistant for chat and voice': 'Assistente sul dispositivo per chat e voce',
  'Contacts and chat': 'Contatti e chat', 'Pay and message your Nostr contacts': 'Paga e scrivi ai tuoi contatti Nostr',
  'Places to pay': 'Dove pagare', 'Nearby businesses accepting bitcoin': 'Attività vicine che accettano bitcoin',
  'Wallet connections': 'Connessioni portafoglio', 'Connect an NWC wallet to this app': 'Collega un portafoglio NWC a questa app',
  'RGB Lightning node': 'Nodo RGB Lightning', 'Use your own RGB Lightning node': 'Usa il tuo nodo RGB Lightning',
  'Turn on RGB Lightning node in Settings → Labs to connect one.': 'Attiva Nodo RGB Lightning in Impostazioni → Labs per collegarne uno.',
  'Send crash reports': 'Invia report dei crash',
  'Crash details help us fix bugs. Never balances, addresses, keys or your recovery phrase.': 'I dettagli dei crash ci aiutano a correggere i bug. Mai saldi, indirizzi, chiavi o la frase di recupero.',
  'Lightning channels': 'Canali Lightning', 'Open channels with a liquidity provider': 'Apri canali con un fornitore di liquidità',
  'Loading voice · first use may take a few minutes': 'Caricamento voce · il primo avvio può richiedere alcuni minuti',
};
export function translate(language: AppLanguage, text: string): string {
  return language === 'it' ? prismoItalian[text] ?? italian[text] ?? text : text;
}
