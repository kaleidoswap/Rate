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
  "Browser connection": "Collegamento al browser",
  "Pair a browser": "Collega un browser",
  "Approve RGB payments on this phone": "Autorizza i pagamenti RGB da questo telefono",
  "Paired browser": "Browser collegato",
  "Disconnect browser": "Scollega il browser",
  "Keep the app open to review RGB payments. Each payment requires your passkey.": "Tieni aperta l’app per verificare i pagamenti RGB. Ogni pagamento richiede la tua passkey.",
  "In the KaleidoSwap extension, choose the phone wallet and scan its QR code. Your RGB wallet stays on this phone.": "Nell’estensione KaleidoSwap scegli il wallet sul telefono e scansiona il codice QR. Il wallet RGB resta su questo telefono.",
  "Browser requesting access": "Browser che richiede l’accesso",
  "Pair only a code shown by your own browser. This allows it to request RGB payments for you to review.": "Verifica che il codice sia quello mostrato nel tuo browser. Il browser potrà inviarti pagamenti RGB da autorizzare.",
  "Pair with passkey": "Collega con la passkey",
  "Scan another code": "Scansiona un altro codice",
  "Scan browser QR code": "Scansiona il QR del browser",
  "Open Scan from the wallet to pair your browser.": "Apri lo scanner dal wallet per collegare il browser.",
  "Scan the QR code shown by your KaleidoSwap browser extension.": "Scansiona il codice QR mostrato dall’estensione KaleidoSwap.",
  "Approve RGB payment": "Autorizza il pagamento RGB",
  "Site reported by your paired browser": "Sito indicato dal browser collegato",
  "Requested by": "Richiesto da",
  "KaleidoSwap browser extension": "Estensione KaleidoSwap",
  "Asset contract": "Contratto dell’asset",
  "Recipient": "Destinatario",
  "Amount": "Importo",
  "base units": "unità minime",
  "Bitcoin miner fee rate": "Commissione Bitcoin per vbyte",
  "Bitcoin sent with the asset": "Bitcoin inviati insieme all’asset",
  "Confirm with passkey": "Conferma con la passkey",
  "Decline payment": "Rifiuta il pagamento",
  "Scan a KaleidoSwap browser pairing code.": "Scansiona un codice di collegamento dell’estensione KaleidoSwap.",
  "Invalid browser pairing code.": "Il codice di collegamento del browser non è valido.",
  "Request expired or invalid. Create a new request.": "La richiesta è scaduta o non è valida. Creane una nuova.",
  "Open and unlock the paired wallet on the phone.": "Apri e sblocca il wallet sul telefono.",
  "Enable RGB on this phone for the active wallet.": "Attiva RGB su questo telefono per il wallet selezionato.",
  "Disconnect the current browser before pairing another one.": "Scollega il browser attuale prima di collegarne un altro.",
  "Disconnect the saved browser before pairing another one.": "Scollega il browser salvato prima di collegarne un altro.",
  "Browser connection failed.": "Collegamento al browser non riuscito.",
  "Invalid pairing invitation.": "Invito di collegamento non valido.",
  "Payment declined or expired on the phone.": "Pagamento rifiutato o scaduto sul telefono.",
  "Another passkey request is in progress.": "È già in corso una richiesta passkey.",
  "Enroll a wallet passkey before connecting the browser.": "Registra una passkey del wallet prima di collegare il browser.",
  "The wallet could not verify the passkey.": "Il wallet non è riuscito a verificare la passkey.",
  "Passkeys for browser payments are unavailable in this build.": "Questa versione dell’app non supporta le passkey per i pagamenti dal browser.",
  "Missing payment details.": "Mancano i dettagli del pagamento.",
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
  'Connected apps': 'App collegate', 'Manage WebRGB connections': 'Gestisci le connessioni WebRGB',
  'Create Utexo Mint invoice': 'Crea fattura per Utexo Mint',
  'Choose “Paste invoice” in Utexo Mint to receive on public Signet.': 'Scegli “Paste invoice” su Utexo Mint per ricevere su Signet pubblica.',
  'Select Signet in Settings → Advanced → RGB → This phone to receive from Utexo Mint.': 'Seleziona Signet in Impostazioni → Avanzate → RGB → Questo telefono per ricevere da Utexo Mint.',
  'Connect this app?': 'Collegare questa app?', 'Approve this request?': 'Approvare questa richiesta?',
  Approve: 'Approva', Decline: 'Rifiuta', Connect: 'Collega', Disconnect: 'Disconnetti',
  'The app supplies its own name. Check the Nostr public key before connecting.': 'Il nome è fornito dall’app. Verifica la chiave pubblica Nostr prima di collegarti.',
  'Scan NWC authorization QR': 'Scansiona QR di autorizzazione NWC', 'No WebRGB apps connected.': 'Nessuna app WebRGB collegata.',
  'Could not restore NWC connections.': 'Impossibile ripristinare le connessioni NWC.',
  'Could not disconnect this app. Try again.': 'Impossibile disconnettere questa app. Riprova.',
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
