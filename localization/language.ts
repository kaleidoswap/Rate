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
  'Remove from this device': 'Rimuovi da questo dispositivo', Cancel: 'Annulla', Save: 'Salva',
  'Export voice diagnostics': 'Esporta diagnostica vocale', 'Voice details & retry': 'Dettagli voce e riprova',
  'Generating voice…': 'Generazione della voce…',
  'Loading voice · first use may take a few minutes': 'Caricamento voce · il primo avvio può richiedere alcuni minuti',
};
export function translate(language: AppLanguage, text: string): string {
  return language === 'it' ? prismoItalian[text] ?? italian[text] ?? text : text;
}
